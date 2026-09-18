import { skills, employeeSkills, roleSkills, shiftSchedules } from '@shared/schema';
import { db } from '../db';
import { eq, and, or, sql, between, gt, lt, desc, asc, count, sum, avg } from 'drizzle-orm';
import { 
  employees, 
  attendance, 
  leaves, 
  documents, 
  events, 
  eventStaffAssignments,
  performanceReviews,
  reviewSections,
  reviewCriteria,
  employeeGoals,
  employeeFeedback,
  skillAssessments
} from '@shared/schema';
import { formatISO, format as formatDate, parseISO, differenceInDays, subMonths, subWeeks } from 'date-fns';

// Predictive turnover analysis
export async function getPredictiveTurnover(department?: string) {
  try {
    // Factors to consider for turnover risk:
    // 1. Poor performance reviews
    // 2. Frequent absences
    // 3. Low goal achievement
    // 4. Decreased engagement (attendance patterns)
    // 5. Tenure (newer employees tend to leave more frequently)
    
    // Get all active employees
    const employeeQuery = department
      ? db.select()
        .from(employees)
        .where(
          and(
            eq(employees.department, department),
            eq(employees.status, 'active')
          )
        )
      : db.select()
        .from(employees)
        .where(eq(employees.status, 'active'));
    
    const employeeData = await employeeQuery;
    
    // Get recent performance reviews (last 12 months)
    const today = new Date();
    const oneYearAgo = subMonths(today, 12);
    const oneYearAgoStr = formatDate(oneYearAgo, 'yyyy-MM-dd');
    
    const reviewsQuery = db.select({
        id: performanceReviews.id,
        employeeId: performanceReviews.employeeId,
        reviewPeriodEnd: performanceReviews.reviewPeriodEnd,
        overallRating: performanceReviews.overallRating,
        status: performanceReviews.status,
        department: employees.department
      })
      .from(performanceReviews)
      .innerJoin(employees, eq(performanceReviews.employeeId, employees.id))
      .where(
        and(
          sql`${performanceReviews.reviewPeriodEnd} >= ${oneYearAgoStr}`,
          eq(performanceReviews.status, 'completed')
        )
      );
    
    const reviewsData = await reviewsQuery;
    
    // Get leave patterns (excessive leave or sick time)
    const leaveQuery = db.select({
        id: leaves.id,
        employeeId: leaves.employeeId,
        leaveType: leaves.leaveType,
        startDate: leaves.startDate,
        endDate: leaves.endDate,
        duration: sql<number>`${leaves.totalDays}::float8`,
        department: employees.department
      })
      .from(leaves)
      .innerJoin(employees, eq(leaves.employeeId, employees.id))
      .where(
        and(
          sql`${leaves.startDate} >= ${oneYearAgoStr}`,
          eq(leaves.status, 'approved')
        )
      );
    
    const leaveData = await leaveQuery;
    
    // Get attendance data to identify patterns
    const attendanceQuery = db.select({
        id: attendance.id,
        employeeId: attendance.employeeId,
        date: attendance.date,
        checkIn: attendance.checkIn,
        checkOut: attendance.checkOut,
        lateMinutes: sql<number>`coalesce((select greatest(0,extract(epoch from (${attendance.checkIn}-s.start_time))/60)::integer from shift_schedules s where s.employee_id=${attendance.employeeId} and s.date=${attendance.date} order by s.start_time limit 1),0)`,
        earlyDepartureMinutes: sql<number>`coalesce((select greatest(0,extract(epoch from (s.end_time-${attendance.checkOut}))/60)::integer from shift_schedules s where s.employee_id=${attendance.employeeId} and s.date=${attendance.date} order by s.end_time desc limit 1),0)`,
        department: employees.department
      })
      .from(attendance)
      .innerJoin(employees, eq(attendance.employeeId, employees.id))
      .where(sql`${attendance.date} >= ${oneYearAgoStr}`);
    
    const attendanceData = await attendanceQuery;
    
    // Calculate turnover risk for each employee
    const turnoverRiskData = employeeData.map(employee => {
      // Performance review score (lower score = higher risk)
      const employeeReviews = reviewsData.filter(review => review.employeeId === employee.id);
      let performanceScore = 0.5; // Default neutral score
      
      if (employeeReviews.length > 0) {
        // Calculate score based on ratings (scale of 0-1, higher is better)
        const ratingMap: Record<string, number> = {
          'exceptional': 1.0,
          'exceeds': 0.8,
          'meets': 0.6,
          'needs_improvement': 0.3,
          'unsatisfactory': 0.1
        };
        
        let totalRatingScore = 0;
        let ratingCount = 0;
        
        employeeReviews.forEach(review => {
          if (review.overallRating && ratingMap[review.overallRating]) {
            totalRatingScore += ratingMap[review.overallRating];
            ratingCount++;
          }
        });
        
        if (ratingCount > 0) {
          performanceScore = totalRatingScore / ratingCount;
        }
      }
      
      // Absence patterns (higher = higher risk)
      const employeeLeaves = leaveData.filter(leave => leave.employeeId === employee.id);
      let absenceScore = 0.5; // Default neutral score
      
      if (employeeLeaves.length > 0) {
        // Calculate total sick leaves vs. total leaves
        const sickLeaves = employeeLeaves.filter(leave => leave.leaveType === 'sick');
        const totalLeaveDays = employeeLeaves.reduce((total, leave) => total + Number(leave.duration), 0);
        const sickLeaveDays = sickLeaves.reduce((total, leave) => total + Number(leave.duration), 0);
        
        // More than 15 sick days per year is concerning, more than 30 is high risk
        if (sickLeaveDays > 30) {
          absenceScore = 0.9;
        } else if (sickLeaveDays > 15) {
          absenceScore = 0.7;
        } else if (sickLeaveDays > 10) {
          absenceScore = 0.6;
        } else if (sickLeaveDays < 5) {
          absenceScore = 0.3; // Low sick leave is good
        }
      }
      
      // Attendance patterns (higher = higher risk)
      const employeeAttendance = attendanceData.filter(record => record.employeeId === employee.id);
      let attendanceScore = 0.5; // Default neutral score
      
      if (employeeAttendance.length > 0) {
        // Calculate late arrivals and early departures
        const lateCount = employeeAttendance.filter(record => record.lateMinutes > 15).length;
        const earlyDepartureCount = employeeAttendance.filter(record => record.earlyDepartureMinutes > 15).length;
        const totalRecords = employeeAttendance.length;
        
        // If more than 20% of days have attendance issues, that's concerning
        const issueRate = (lateCount + earlyDepartureCount) / totalRecords;
        
        if (issueRate > 0.3) {
          attendanceScore = 0.8;
        } else if (issueRate > 0.2) {
          attendanceScore = 0.7;
        } else if (issueRate > 0.1) {
          attendanceScore = 0.6;
        } else {
          attendanceScore = 0.4; // Good attendance
        }
      }
      
      // Tenure/Experience factor (higher = higher risk)
      let tenureScore = 0.5;
      if (employee.joiningDate) {
        const hireDate = new Date(employee.joiningDate);
        const tenureMonths = differenceInDays(today, hireDate) / 30;
        
        // First 12 months highest risk, then 12-24, then 24-36, then stabilizes
        if (tenureMonths < 6) {
          tenureScore = 0.9;
        } else if (tenureMonths < 12) {
          tenureScore = 0.8;
        } else if (tenureMonths < 24) {
          tenureScore = 0.7;
        } else if (tenureMonths < 36) {
          tenureScore = 0.6;
        } else {
          tenureScore = 0.4; // Longer tenure is lower risk
        }
      }
      
      // Calculate weighted risk score (0-100, higher = higher risk)
      // Performance has highest weight, followed by attendance, absences, then tenure
      const weightedRiskScore = Math.round(
        ((1 - performanceScore) * 0.4) + // Performance (inverted so lower performance = higher risk)
        (attendanceScore * 0.25) +       // Attendance
        (absenceScore * 0.2) +           // Absences
        (tenureScore * 0.15)             // Tenure
      * 100);
      
      // Categorize risk
      let riskCategory = 'low';
      if (weightedRiskScore >= 70) {
        riskCategory = 'high';
      } else if (weightedRiskScore >= 50) {
        riskCategory = 'medium';
      }
      
      return {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        email: employee.workEmail,
        department: employee.department,
        jobTitle: employee.position,
        riskScore: weightedRiskScore,
        riskCategory,
        riskFactors: {
          performanceScore: Math.round(performanceScore * 100),
          attendanceScore: Math.round(attendanceScore * 100),
          absenceScore: Math.round(absenceScore * 100),
          tenureScore: Math.round(tenureScore * 100)
        }
      };
    });
    
    // Sort by risk score, highest first
    turnoverRiskData.sort((a, b) => b.riskScore - a.riskScore);
    
    // Calculate departmental statistics
    const departmentStats: Record<string, { 
      department: string, 
      employeeCount: number, 
      highRiskCount: number,
      mediumRiskCount: number,
      lowRiskCount: number,
      averageRiskScore: number 
    }> = {};
    
    turnoverRiskData.forEach(employee => {
      if (!departmentStats[employee.department]) {
        departmentStats[employee.department] = {
          department: employee.department,
          employeeCount: 0,
          highRiskCount: 0,
          mediumRiskCount: 0,
          lowRiskCount: 0,
          averageRiskScore: 0
        };
      }
      
      departmentStats[employee.department].employeeCount++;
      departmentStats[employee.department].averageRiskScore += employee.riskScore;
      
      if (employee.riskCategory === 'high') {
        departmentStats[employee.department].highRiskCount++;
      } else if (employee.riskCategory === 'medium') {
        departmentStats[employee.department].mediumRiskCount++;
      } else {
        departmentStats[employee.department].lowRiskCount++;
      }
    });
    
    // Calculate averages for each department
    Object.values(departmentStats).forEach(dept => {
      dept.averageRiskScore = Math.round(dept.averageRiskScore / dept.employeeCount);
    });
    
    // If specific department requested, filter data
    const filteredRiskData = department
      ? turnoverRiskData.filter(employee => employee.department === department)
      : turnoverRiskData;
    
    // Calculate overall statistics
    const overallStats = {
      employeeCount: filteredRiskData.length,
      highRiskCount: filteredRiskData.filter(e => e.riskCategory === 'high').length,
      mediumRiskCount: filteredRiskData.filter(e => e.riskCategory === 'medium').length,
      lowRiskCount: filteredRiskData.filter(e => e.riskCategory === 'low').length,
      averageRiskScore: Math.round(
        filteredRiskData.reduce((sum, e) => sum + e.riskScore, 0) / filteredRiskData.length
      )
    };
    
    return {
      employees: filteredRiskData,
      departmentStats: Object.values(departmentStats),
      overallStats,
      analysisDate: formatDate(today, 'yyyy-MM-dd')
    };
  } catch (error) {
    console.error('Error generating predictive turnover analysis:', error);
    throw error;
  }
}

// Skill gap analysis
export async function getSkillGapAnalysis(department?: string) {
  try {
    // Get all skills assessed
    const skillsQuery = db.select({
        id: skillAssessments.id,
        employeeId: skillAssessments.employeeId,
        skillName: skills.name,
        proficiencyLevel: sql<number>`coalesce(${skillAssessments.managerAssessmentRating},${skillAssessments.selfAssessmentRating},${employeeSkills.proficiencyLevel})`,
        isRequired: sql<boolean>`${roleSkills.id} is not null`,
        importance: sql<number>`case ${roleSkills.importance} when 'critical' then 5 when 'important' then 3 when 'nice_to_have' then 1 else 0 end`,
        assessmentDate: skillAssessments.assessmentDate,
        department: employees.department
      })
      .from(skillAssessments)
      .innerJoin(employees, eq(skillAssessments.employeeId, employees.id))
      .innerJoin(employeeSkills,eq(skillAssessments.skillId,employeeSkills.id))
      .innerJoin(skills,eq(employeeSkills.skillId,skills.id))
      .leftJoin(roleSkills,and(eq(roleSkills.roleId,employees.roleId),eq(roleSkills.skillId,skills.id)))
      .orderBy(desc(skillAssessments.assessmentDate));
    
    let skillsData = await skillsQuery;
    
    // Filter by department if specified
    if (department) {
      skillsData = skillsData.filter(skill => skill.department === department);
    }
    
    // Group skills by name to identify common skills
    const skillsByName: Record<string, {
      skillName: string,
      totalAssessments: number,
      requiredCount: number,
      importanceSum: number,
      proficiencySum: number,
      averageImportance: number,
      averageProficiency: number,
      gapScore: number,
      employees: Array<{
        employeeId: number,
        proficiencyLevel: number,
        assessmentDate: string
      }>
    }> = {};
    
    skillsData.forEach(skill => {
      if (!skillsByName[skill.skillName]) {
        skillsByName[skill.skillName] = {
          skillName: skill.skillName,
          totalAssessments: 0,
          requiredCount: 0,
          importanceSum: 0,
          proficiencySum: 0,
          averageImportance: 0,
          averageProficiency: 0,
          gapScore: 0,
          employees: []
        };
      }
      
      skillsByName[skill.skillName].totalAssessments++;
      
      if (skill.isRequired) {
        skillsByName[skill.skillName].requiredCount++;
      }
      
      skillsByName[skill.skillName].importanceSum += skill.importance;
      skillsByName[skill.skillName].proficiencySum += skill.proficiencyLevel;
      
      skillsByName[skill.skillName].employees.push({
        employeeId: skill.employeeId,
        proficiencyLevel: skill.proficiencyLevel,
        assessmentDate: skill.assessmentDate
      });
    });
    
    // Calculate averages and gap scores
    Object.values(skillsByName).forEach(skill => {
      skill.averageImportance = parseFloat((skill.importanceSum / skill.totalAssessments).toFixed(2));
      skill.averageProficiency = parseFloat((skill.proficiencySum / skill.totalAssessments).toFixed(2));
      
      // Gap score is higher when importance is high but proficiency is low
      // Scale: 0-10, higher means bigger gap (more critical to address)
      skill.gapScore = parseFloat(((skill.averageImportance * 2) - skill.averageProficiency).toFixed(2));
      if (skill.gapScore < 0) skill.gapScore = 0;
      
      // Sort employees by proficiency level (lowest first)
      skill.employees.sort((a, b) => a.proficiencyLevel - b.proficiencyLevel);
    });
    
    // Get employee data for reference
    const employeeQuery = db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      email: employees.workEmail,
      department: employees.department,
      jobTitle: employees.position
    })
    .from(employees);
    
    const employeeData = await employeeQuery;
    
    // Create a map for easy lookup
    const employeeMap = new Map();
    employeeData.forEach(emp => {
      employeeMap.set(emp.id, emp);
    });
    
    // Identify top skill gaps (skills with highest gap scores)
    const skillGaps = Object.values(skillsByName)
      .sort((a, b) => b.gapScore - a.gapScore)
      .map(skill => ({
        ...skill,
        // Add only first 5 employees with lowest proficiency for each skill
        lowProficiencyEmployees: skill.employees
          .slice(0, 5)
          .map(emp => {
            const employee = employeeMap.get(emp.employeeId);
            return {
              id: emp.employeeId,
              name: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
              department: employee ? employee.department : 'Unknown',
              jobTitle: employee ? employee.position : 'Unknown',
              proficiencyLevel: emp.proficiencyLevel,
              assessmentDate: emp.assessmentDate
            };
          })
      }));
    
    // Identify employees with most skill gaps
    const employeeGaps: Record<number, {
      id: number,
      name: string,
      department: string,
      jobTitle: string,
      gapCount: number,
      averageGapScore: number,
      criticalSkillGaps: Array<{
        skillName: string,
        proficiencyLevel: number,
        importance: number,
        gapScore: number
      }>
    }> = {};
    
    // For each employee, find skills where they have a proficiency below the requirement
    employeeData.forEach(employee => {
      const employeeSkills = skillsData.filter(skill => skill.employeeId === employee.id);
      
      if (employeeSkills.length === 0) return; // Skip if employee has no skill assessments
      
      const skillGaps = employeeSkills.filter(skill => {
        const skillInfo = skillsByName[skill.skillName];
        // Consider it a gap if proficiency is below average and it's an important or required skill
        return skill.proficiencyLevel < skillInfo.averageProficiency && 
               (skill.isRequired || skill.importance >= 3);
      });
      
      if (skillGaps.length > 0) {
        const totalGapScore = skillGaps.reduce((sum, skill) => {
          const importance = skill.importance;
          const proficiency = skill.proficiencyLevel;
          const gapScore = (importance * 2) - proficiency;
          return sum + (gapScore > 0 ? gapScore : 0);
        }, 0);
        
        employeeGaps[employee.id] = {
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
          department: employee.department,
          jobTitle: employee.jobTitle,
          gapCount: skillGaps.length,
          averageGapScore: parseFloat((totalGapScore / skillGaps.length).toFixed(2)),
          criticalSkillGaps: skillGaps
            .map(skill => ({
              skillName: skill.skillName,
              proficiencyLevel: skill.proficiencyLevel,
              importance: skill.importance,
              gapScore: (skill.importance * 2) - skill.proficiencyLevel
            }))
            .sort((a, b) => b.gapScore - a.gapScore)
            .slice(0, 5) // Top 5 most critical gaps
        };
      }
    });
    
    // Calculate department-level statistics
    const departmentGaps: Record<string, {
      department: string,
      employeeCount: number,
      skillGapCount: number,
      averageGapScore: number,
      topSkillGaps: Array<{
        skillName: string,
        gapScore: number,
        averageProficiency: number,
        averageImportance: number
      }>
    }> = {};
    
    Object.values(employeeGaps).forEach(employee => {
      if (!departmentGaps[employee.department]) {
        departmentGaps[employee.department] = {
          department: employee.department,
          employeeCount: 0,
          skillGapCount: 0,
          averageGapScore: 0,
          topSkillGaps: []
        };
      }
      
      departmentGaps[employee.department].employeeCount++;
      departmentGaps[employee.department].skillGapCount += employee.gapCount;
      departmentGaps[employee.department].averageGapScore += employee.averageGapScore;
      
      // Track skill gaps at department level
      employee.criticalSkillGaps.forEach(gap => {
        const existingGap = departmentGaps[employee.department].topSkillGaps.find(
          g => g.skillName === gap.skillName
        );
        
        if (!existingGap) {
          departmentGaps[employee.department].topSkillGaps.push({
            skillName: gap.skillName,
            gapScore: gap.gapScore,
            averageProficiency: skillsByName[gap.skillName].averageProficiency,
            averageImportance: skillsByName[gap.skillName].averageImportance
          });
        }
      });
    });
    
    // Calculate averages and sort top skill gaps
    Object.values(departmentGaps).forEach(dept => {
      if (dept.employeeCount > 0) {
        dept.averageGapScore = parseFloat((dept.averageGapScore / dept.employeeCount).toFixed(2));
      }
      
      dept.topSkillGaps.sort((a, b) => b.gapScore - a.gapScore);
      dept.topSkillGaps = dept.topSkillGaps.slice(0, 5); // Keep only top 5
    });
    
    // Sort employees by gap score
    const employeesWithGaps = Object.values(employeeGaps)
      .sort((a, b) => b.averageGapScore - a.averageGapScore);
    
    // Filter by department if needed
    const filteredDepartmentGaps = department
      ? Object.values(departmentGaps).filter(dept => dept.department === department)
      : Object.values(departmentGaps);
    
    const filteredEmployeesWithGaps = department
      ? employeesWithGaps.filter(emp => emp.department === department)
      : employeesWithGaps;
    
    // Get counts of employees missing critical skills
    const employeesMissingCriticalSkills = filteredEmployeesWithGaps.filter(
      emp => emp.criticalSkillGaps.some(gap => gap.gapScore >= 5)
    ).length;
    
    // Overall statistics
    const overallStats = {
      totalSkillsAssessed: Object.keys(skillsByName).length,
      employeesWithGaps: filteredEmployeesWithGaps.length,
      employeesMissingCriticalSkills,
      departmentsAnalyzed: filteredDepartmentGaps.length,
      averageGapScore: parseFloat((
        filteredEmployeesWithGaps.reduce((sum, emp) => sum + emp.averageGapScore, 0) / 
        (filteredEmployeesWithGaps.length || 1)
      ).toFixed(2))
    };
    
    return {
      skillGaps: skillGaps.slice(0, 20), // Top 20 skill gaps
      employeeGaps: filteredEmployeesWithGaps.slice(0, 50), // Top 50 employees with gaps
      departmentGaps: filteredDepartmentGaps,
      overallStats,
      analysisDate: formatDate(new Date(), 'yyyy-MM-dd')
    };
  } catch (error) {
    console.error('Error generating skill gap analysis:', error);
    throw error;
  }
}

// Performance trends analysis
export async function getPerformanceTrends(timeSpan: number = 12, department?: string) {
  try {
    // Default to 12 months if not specified
    const months = timeSpan > 0 ? timeSpan : 12;
    const startDate = subMonths(new Date(), months);
    const startDateStr = formatDate(startDate, 'yyyy-MM-dd');
    
    // Get performance reviews within the time period
    const reviewsQuery = db.select({
        id: performanceReviews.id,
        employeeId: performanceReviews.employeeId,
        reviewPeriodEnd: performanceReviews.reviewPeriodEnd,
        overallRating: performanceReviews.overallRating,
        status: performanceReviews.status,
        department: employees.department
      })
      .from(performanceReviews)
      .innerJoin(employees, eq(performanceReviews.employeeId, employees.id))
      .where(
        and(
          sql`${performanceReviews.reviewPeriodEnd} >= ${startDateStr}`,
          eq(performanceReviews.status, 'completed')
        )
      );
    
    let reviewsData = await reviewsQuery;
    
    // Filter by department if specified
    if (department) {
      reviewsData = reviewsData.filter(review => review.department === department);
    }
    
    // Extract ratings as numbers for analysis
    const ratingValues: Record<string, number> = {
      'exceptional': 5,
      'exceeds': 4,
      'meets': 3,
      'needs_improvement': 2,
      'unsatisfactory': 1
    };
    
    // Group reviews by month and department
    const reviewsByMonth: Record<string, Array<{
      id: number,
      employeeId: number,
      department: string,
      rating: string,
      ratingValue: number
    }>> = {};
    
    reviewsData.forEach(review => {
      if (!review.reviewPeriodEnd) return;
      
      const monthYear = review.reviewPeriodEnd.substring(0, 7); // YYYY-MM format
      
      if (!reviewsByMonth[monthYear]) {
        reviewsByMonth[monthYear] = [];
      }
      
      reviewsByMonth[monthYear].push({
        id: review.id,
        employeeId: review.employeeId,
        department: review.department,
        rating: review.overallRating || 'no_rating',
        ratingValue: review.overallRating ? ratingValues[review.overallRating] : 0
      });
    });
    
    // Calculate monthly trends
    const monthlyTrends = Object.entries(reviewsByMonth)
      .map(([month, reviews]) => {
        const total = reviews.length;
        const ratingCounts: Record<string, number> = {
          'exceptional': 0,
          'exceeds': 0,
          'meets': 0,
          'needs_improvement': 0,
          'unsatisfactory': 0,
          'no_rating': 0
        };
        
        let ratingSum = 0;
        
        reviews.forEach(review => {
          if (review.rating) {
            ratingCounts[review.rating]++;
          }
          
          ratingSum += review.ratingValue;
        });
        
        const averageRating = total > 0 ? parseFloat((ratingSum / total).toFixed(2)) : 0;
        
        // Also calculate by department if not filtered
        const departmentStats: Record<string, {
          department: string,
          count: number,
          averageRating: number,
          ratingCounts: Record<string, number>
        }> = {};
        
        if (!department) {
          reviews.forEach(review => {
            if (!departmentStats[review.department]) {
              departmentStats[review.department] = {
                department: review.department,
                count: 0,
                averageRating: 0,
                ratingCounts: {
                  'exceptional': 0,
                  'exceeds': 0,
                  'meets': 0,
                  'needs_improvement': 0,
                  'unsatisfactory': 0,
                  'no_rating': 0
                }
              };
            }
            
            departmentStats[review.department].count++;
            departmentStats[review.department].ratingCounts[review.rating]++;
          });
          
          // Calculate average for each department
          Object.values(departmentStats).forEach(dept => {
            let deptRatingSum = 0;
            
            Object.entries(dept.ratingCounts).forEach(([rating, count]) => {
              if (rating !== 'no_rating') {
                deptRatingSum += ratingValues[rating] * count;
              }
            });
            
            dept.averageRating = dept.count > 0 ? 
              parseFloat((deptRatingSum / dept.count).toFixed(2)) : 0;
          });
        }
        
        return {
          month,
          displayMonth: `${new Date(month + '-01').toLocaleString('default', { month: 'short' })} ${month.substring(0, 4)}`,
          reviewCount: total,
          averageRating,
          ratingCounts,
          departmentStats: Object.values(departmentStats)
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
    
    // Calculate overall performance trend
    const startAvg = monthlyTrends[0]?.averageRating || 0;
    const endAvg = monthlyTrends[monthlyTrends.length - 1]?.averageRating || 0;
    const trend = parseFloat((endAvg - startAvg).toFixed(2));
    
    // Trend direction
    let trendDirection = 'stable';
    if (trend > 0.3) {
      trendDirection = 'improving';
    } else if (trend < -0.3) {
      trendDirection = 'declining';
    }
    
    // Department trends over the period
    const departmentTrends: Record<string, {
      department: string,
      reviewCount: number,
      startAverage: number,
      endAverage: number,
      trend: number,
      trendDirection: string
    }> = {};
    
    // Only calculate if we have data for multiple months
    if (monthlyTrends.length > 1) {
      // Extract unique departments from all months
      const departments = new Set<string>();
      monthlyTrends.forEach(month => {
        month.departmentStats.forEach(dept => {
          departments.add(dept.department);
        });
      });
      
      // Calculate trend for each department
      departments.forEach(dept => {
        // Find first and last month with data for this department
        let startMonth = null;
        let endMonth = null;
        
        for (let i = 0; i < monthlyTrends.length; i++) {
          const deptStat = monthlyTrends[i].departmentStats.find(d => d.department === dept);
          if (deptStat && deptStat.count > 0) {
            if (!startMonth) startMonth = deptStat;
          }
        }
        
        for (let i = monthlyTrends.length - 1; i >= 0; i--) {
          const deptStat = monthlyTrends[i].departmentStats.find(d => d.department === dept);
          if (deptStat && deptStat.count > 0) {
            if (!endMonth) endMonth = deptStat;
          }
        }
        
        if (startMonth && endMonth) {
          const deptTrend = parseFloat((endMonth.averageRating - startMonth.averageRating).toFixed(2));
          
          let deptTrendDirection = 'stable';
          if (deptTrend > 0.3) {
            deptTrendDirection = 'improving';
          } else if (deptTrend < -0.3) {
            deptTrendDirection = 'declining';
          }
          
          // Count total reviews for this department
          const reviewCount = monthlyTrends.reduce((sum, month) => {
            const deptStat = month.departmentStats.find(d => d.department === dept);
            return sum + (deptStat ? deptStat.count : 0);
          }, 0);
          
          departmentTrends[dept] = {
            department: dept,
            reviewCount,
            startAverage: startMonth.averageRating,
            endAverage: endMonth.averageRating,
            trend: deptTrend,
            trendDirection: deptTrendDirection
          };
        }
      });
    }
    
    // Count total reviews
    const totalReviews = reviewsData.length;
    
    // Calculate average ratings distribution
    const overallRatingCounts: Record<string, number> = {
      'exceptional': 0,
      'exceeds': 0,
      'meets': 0,
      'needs_improvement': 0,
      'unsatisfactory': 0,
      'no_rating': 0
    };
    
    reviewsData.forEach(review => {
      if (review.overallRating) {
        overallRatingCounts[review.overallRating]++;
      } else {
        overallRatingCounts['no_rating']++;
      }
    });
    
    // Calculate overall average rating
    let overallRatingSum = 0;
    reviewsData.forEach(review => {
      if (review.overallRating) {
        overallRatingSum += ratingValues[review.overallRating];
      }
    });
    
    const overallAverageRating = totalReviews > 0 ? 
      parseFloat((overallRatingSum / totalReviews).toFixed(2)) : 0;
    
    return {
      timeSpan: {
        months,
        startDate: startDateStr,
        endDate: formatDate(new Date(), 'yyyy-MM-dd')
      },
      monthlyTrends,
      overallStats: {
        totalReviews,
        averageRating: overallAverageRating,
        ratingCounts: overallRatingCounts,
        trend,
        trendDirection
      },
      departmentTrends: Object.values(departmentTrends),
      analysisDate: formatDate(new Date(), 'yyyy-MM-dd'),
      department: department || 'All Departments'
    };
  } catch (error) {
    console.error('Error generating performance trends analysis:', error);
    throw error;
  }
}

// Custom report execution
export async function executeCustomReport(reportParams: any) {
  try {
    const { dataSource, filters, groupBy, aggregations, limit } = reportParams;
    
    // Validate report parameters
    if (!dataSource) {
      throw new Error('Data source must be specified');
    }
    
    // Build and execute the query based on parameters
    let query;
    
    switch (dataSource) {
      case 'employees':
        query = buildEmployeeQuery(filters, groupBy, aggregations);
        break;
      case 'attendance':
        query = buildAttendanceQuery(filters, groupBy, aggregations);
        break;
      case 'leaves':
        query = buildLeavesQuery(filters, groupBy, aggregations);
        break;
      case 'performance_reviews':
        query = buildPerformanceQuery(filters, groupBy, aggregations);
        break;
      case 'documents':
        query = buildDocumentsQuery(filters, groupBy, aggregations);
        break;
      case 'events':
        query = buildEventsQuery(filters, groupBy, aggregations);
        break;
      default:
        throw new Error(`Unsupported data source: ${dataSource}`);
    }
    
    // Apply limit if specified
    if (limit && limit > 0) {
      query = query.limit(limit);
    }
    
    // Execute query
    const results = await query;
    
    return {
      dataSource,
      parameters: reportParams,
      resultCount: results.length,
      results,
      executionDate: formatDate(new Date(), 'yyyy-MM-dd')
    };
  } catch (error) {
    console.error('Error executing custom report:', error);
    throw error;
  }
}

// Helper functions to build queries
function buildEmployeeQuery(filters: any, groupBy: string[] = [], aggregations: any[] = []) {
  let query = db.select().from(employees).$dynamic();
  
  // Apply filters
  if (filters && Object.keys(filters).length > 0) {
    const conditions = [];
    
    if (filters.department) {
      conditions.push(eq(employees.department, filters.department));
    }
    
    if (filters.status) {
      conditions.push(eq(employees.status, filters.status));
    }
    
    if (filters.employmentType) {
      conditions.push(eq(employees.type, filters.employmentType));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
  }
  
  // Apply grouping
  if (groupBy && groupBy.length > 0) {
    // Group by specific fields
    // This would need a more complex implementation with raw SQL for proper support
  }
  
  return query;
}

function buildAttendanceQuery(filters: any, groupBy: string[] = [], aggregations: any[] = []) {
  let query = db.select({
      id: attendance.id,
      employeeId: attendance.employeeId,
      date: attendance.date,
      checkIn: attendance.checkIn,
      checkOut: attendance.checkOut,
      status: attendance.status,
      lateMinutes: sql<number>`coalesce((select greatest(0,extract(epoch from (${attendance.checkIn}-s.start_time))/60)::integer from shift_schedules s where s.employee_id=${attendance.employeeId} and s.date=${attendance.date} order by s.start_time limit 1),0)`,
      earlyDepartureMinutes: sql<number>`coalesce((select greatest(0,extract(epoch from (s.end_time-${attendance.checkOut}))/60)::integer from shift_schedules s where s.employee_id=${attendance.employeeId} and s.date=${attendance.date} order by s.end_time desc limit 1),0)`,
      department: employees.department
    })
    .from(attendance)
    .leftJoin(employees, eq(attendance.employeeId, employees.id)).$dynamic();
  
  // Apply filters
  if (filters && Object.keys(filters).length > 0) {
    const conditions = [];
    
    if (filters.department) {
      conditions.push(eq(employees.department, filters.department));
    }
    
    if (filters.startDate) {
      conditions.push(sql`${attendance.date} >= ${filters.startDate}`);
    }
    
    if (filters.endDate) {
      conditions.push(sql`${attendance.date} <= ${filters.endDate}`);
    }
    
    if (filters.status) {
      conditions.push(eq(attendance.status, filters.status));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
  }
  
  return query;
}

function buildLeavesQuery(filters: any, groupBy: string[] = [], aggregations: any[] = []) {
  let query = db.select({
      id: leaves.id,
      employeeId: leaves.employeeId,
      leaveType: leaves.leaveType,
      startDate: leaves.startDate,
      endDate: leaves.endDate,
      totalDays: sql<number>`${leaves.totalDays}::float8`,
      status: leaves.status,
      department: employees.department
    })
    .from(leaves)
    .leftJoin(employees, eq(leaves.employeeId, employees.id)).$dynamic();
  
  // Apply filters
  if (filters && Object.keys(filters).length > 0) {
    const conditions = [];
    
    if (filters.department) {
      conditions.push(eq(employees.department, filters.department));
    }
    
    if (filters.leaveType) {
      conditions.push(eq(leaves.leaveType, filters.leaveType));
    }
    
    if (filters.status) {
      conditions.push(eq(leaves.status, filters.status));
    }
    
    if (filters.startDate) {
      conditions.push(sql`${leaves.startDate} >= ${filters.startDate}`);
    }
    
    if (filters.endDate) {
      conditions.push(sql`${leaves.endDate} <= ${filters.endDate}`);
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
  }
  
  return query;
}

function buildPerformanceQuery(filters: any, groupBy: string[] = [], aggregations: any[] = []) {
  let query = db.select({
      id: performanceReviews.id,
      employeeId: performanceReviews.employeeId,
      reviewType: performanceReviews.reviewType,
      reviewPeriodStart: performanceReviews.reviewPeriodStart,
      reviewPeriodEnd: performanceReviews.reviewPeriodEnd,
      overallRating: performanceReviews.overallRating,
      status: performanceReviews.status,
      department: employees.department
    })
    .from(performanceReviews)
    .leftJoin(employees, eq(performanceReviews.employeeId, employees.id)).$dynamic();
  
  // Apply filters
  if (filters && Object.keys(filters).length > 0) {
    const conditions = [];
    
    if (filters.department) {
      conditions.push(eq(employees.department, filters.department));
    }
    
    if (filters.reviewType) {
      conditions.push(eq(performanceReviews.reviewType, filters.reviewType));
    }
    
    if (filters.status) {
      conditions.push(eq(performanceReviews.status, filters.status));
    }
    
    if (filters.startDate) {
      conditions.push(sql`${performanceReviews.reviewPeriodEnd} >= ${filters.startDate}`);
    }
    
    if (filters.endDate) {
      conditions.push(sql`${performanceReviews.reviewPeriodEnd} <= ${filters.endDate}`);
    }
    
    if (filters.overallRating) {
      conditions.push(eq(performanceReviews.overallRating, filters.overallRating));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
  }
  
  return query;
}

function buildDocumentsQuery(filters: any, groupBy: string[] = [], aggregations: any[] = []) {
  let query = db.select({
      id: documents.id,
      employeeId: documents.employeeId,
      documentType: documents.documentType,
      documentNumber: documents.documentNumber,
      issueDate: documents.issueDate,
      expiryDate: documents.expiryDate,
      status: documents.status,
      department: employees.department
    })
    .from(documents)
    .leftJoin(employees, eq(documents.employeeId, employees.id)).$dynamic();
  
  // Apply filters
  if (filters && Object.keys(filters).length > 0) {
    const conditions = [];
    
    if (filters.department) {
      conditions.push(eq(employees.department, filters.department));
    }
    
    if (filters.documentType) {
      conditions.push(eq(documents.documentType, filters.documentType));
    }
    
    if (filters.status) {
      conditions.push(eq(documents.status, filters.status));
    }
    
    if (filters.expiryBefore) {
      conditions.push(sql`${documents.expiryDate} <= ${filters.expiryBefore}`);
    }
    
    if (filters.expiryAfter) {
      conditions.push(sql`${documents.expiryDate} >= ${filters.expiryAfter}`);
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
  }
  
  return query;
}

function buildEventsQuery(filters: any, groupBy: string[] = [], aggregations: any[] = []) {
  let query = db.select({
      id: events.id,
      eventName: events.name,
      eventType: events.eventType,
      startDate: events.startDate,
      endDate: events.endDate,
      location: events.location,
      status: events.status
    })
    .from(events).$dynamic();
  
  // Apply filters
  if (filters && Object.keys(filters).length > 0) {
    const conditions = [];
    
    if (filters.eventType) {
      conditions.push(eq(events.eventType, filters.eventType));
    }
    
    if (filters.status) {
      conditions.push(eq(events.status, filters.status));
    }
    
    if (filters.startDate) {
      conditions.push(sql`${events.startDate} >= ${filters.startDate}`);
    }
    
    if (filters.endDate) {
      conditions.push(sql`${events.endDate} <= ${filters.endDate}`);
    }
    
    if (filters.location) {
      conditions.push(eq(events.location, filters.location));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
  }
  
  return query;
}

// Export custom report (placeholder for actual export functionality)
export async function exportCustomReport(reportParams: any, format: string) {
  try {
    // First get the report data
    const reportData = await executeCustomReport(reportParams);
    
    // Export format handling (this is a placeholder, would need actual export code)
    let data = '';
    let exportPath = '';
    
    if (format === 'csv') {
      // Convert results to CSV
      data = convertToCSV(reportData.results);
      exportPath = `/exports/report-${Date.now()}.csv`;
    } else if (format === 'excel') {
      // Excel export placeholder
      data = 'Excel data would go here';
      exportPath = `/exports/report-${Date.now()}.xlsx`;
    } else if (format === 'pdf') {
      // PDF export placeholder
      data = 'PDF data would go here';
      exportPath = `/exports/report-${Date.now()}.pdf`;
    }
    
    return {
      data,
      exportPath,
      format,
      timestamp: formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')
    };
  } catch (error) {
    console.error('Error exporting custom report:', error);
    throw error;
  }
}

// Helper function to convert JSON to CSV
function convertToCSV(data: any[]) {
  if (data.length === 0) {
    return '';
  }
  
  // Get headers
  const headers = Object.keys(data[0]);
  
  // Create CSV header row
  let csv = headers.join(',') + '\n';
  
  // Add data rows
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header];
      
      // Handle different data types
      if (value === null || value === undefined) {
        return '';
      } else if (typeof value === 'string') {
        // Escape quotes and wrap in quotes
        return `"${value.replace(/"/g, '""')}"`;
      } else if (typeof value === 'object') {
        // Convert objects to string representation
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      } else {
        return value;
      }
    });
    
    csv += values.join(',') + '\n';
  });
  
  return csv;
}
