import { db } from '../db';
import { employees, skills, roleSkills, employeeSkills, roles, trainingCourses, employeeTraining } from "@shared/schema";
import { eq, and, gt, lt, arrayOverlaps, inArray, desc, gte, lte } from 'drizzle-orm';

interface SkillGapCourseRecommendation {
  courseId: number;
  courseName: string;
  description: string | null;
  relevanceScore: number;
  targetedSkills: number;
  duration: number | null;
  format: string | null;
  alreadyEnrolled: boolean;
}

interface SkillGap {
  skillId: number;
  skillName: string;
  description: string;
  category: string;
  importance: string;
  requiredLevel: number;
  currentLevel: number | null;
  gap: number;
}

interface EmployeeSkillData {
  employeeId: number;
  employeeName: string;
  department: string;
  role: string;
  skillGaps: SkillGap[];
}

// Service to analyze skill gaps for employees in a department
export async function analyzeSkillGapsByDepartment(departmentId: string) {
  try {
    // Get all employees in the department
    const departmentEmployees = await db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      roleId: employees.roleId,
    })
    .from(employees)
    .where(eq(employees.department, departmentId));

    if (departmentEmployees.length === 0) {
      return { 
        success: false as const,
        message: "No employees found in this department", 
        data: [] 
      };
    }

    // Create a detailed analysis for each employee
    const employeeAnalysis: EmployeeSkillData[] = [];
    
    for (const employee of departmentEmployees) {
      if(employee.roleId === null) continue;
      // Get employee's role
      const employeeRole = await db.select()
        .from(roles)
        .where(eq(roles.id, employee.roleId))
        .limit(1);
      
      if (employeeRole.length === 0) {
        continue; // Skip if role not found
      }
      
      const roleName = employeeRole[0].name;
      
      // Get skills required for this role
      const requiredSkills = await db.select({
        skillId: roleSkills.skillId,
        requiredLevel: roleSkills.requiredProficiencyLevel,
        skill: skills, importance:roleSkills.importance
      })
      .from(roleSkills)
      .innerJoin(skills, eq(skills.id, roleSkills.skillId))
      .where(eq(roleSkills.roleId, employee.roleId));
      
      // Get skills the employee already has
      const employeeCurrentSkills = await db.select({
        skillId: employeeSkills.skillId,
        proficiencyLevel: employeeSkills.proficiencyLevel,
        skill: skills
      })
      .from(employeeSkills)
      .innerJoin(skills, eq(skills.id, employeeSkills.skillId))
      .where(eq(employeeSkills.employeeId, employee.id));
      
      // Map employee skills for easy lookup
      const employeeSkillMap = new Map();
      employeeCurrentSkills.forEach(skill => {
        employeeSkillMap.set(skill.skillId, skill.proficiencyLevel);
      });
      
      // Calculate skill gaps
      const skillGaps: SkillGap[] = [];
      
      for (const required of requiredSkills) {
        const currentLevel = employeeSkillMap.get(required.skillId) || null;
        const gap = currentLevel ? required.requiredLevel - currentLevel : required.requiredLevel;
        
        if (gap > 0) {
          skillGaps.push({
            skillId: required.skillId,
            skillName: required.skill.name,
            description: required.skill.description || '',
            category: required.skill.category || 'Uncategorized',
            importance: required.importance,
            requiredLevel: required.requiredLevel,
            currentLevel,
            gap
          });
        }
      }
      
      // Add to the employee analysis if there are skill gaps
      if (skillGaps.length > 0) {
        employeeAnalysis.push({
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          department: employee.department,
          role: roleName,
          skillGaps
        });
      }
    }
    
    // Aggregate the skill gaps across all employees in the department
    const aggregatedSkillGaps = new Map<number, { 
      skillId: number, 
      skillName: string, 
      category: string,
      importance: string,
      description: string,
      employeeCount: number,
      averageGap: number,
      affectedEmployees: { id: number, name: string, gap: number }[]
    }>();
    
    employeeAnalysis.forEach(employee => {
      employee.skillGaps.forEach(gap => {
        if (!aggregatedSkillGaps.has(gap.skillId)) {
          aggregatedSkillGaps.set(gap.skillId, {
            skillId: gap.skillId,
            skillName: gap.skillName,
            category: gap.category,
            importance: gap.importance,
            description: gap.description,
            employeeCount: 0,
            averageGap: 0,
            affectedEmployees: []
          });
        }
        
        const existing = aggregatedSkillGaps.get(gap.skillId)!;
        existing.employeeCount++;
        existing.averageGap = (existing.averageGap * (existing.employeeCount - 1) + gap.gap) / existing.employeeCount;
        existing.affectedEmployees.push({
          id: employee.employeeId,
          name: employee.employeeName,
          gap: gap.gap
        });
      });
    });
    
    // Convert Map to Array and sort by employee count (most affected first)
    const sortedAggregatedGaps = Array.from(aggregatedSkillGaps.values())
      .sort((a, b) => b.employeeCount - a.employeeCount || b.averageGap - a.averageGap);
    
    return {
      success: true as const,
      departmentName: departmentEmployees[0]?.department || "Unknown Department",
      totalEmployees: departmentEmployees.length,
      employeesWithGaps: employeeAnalysis.length,
      aggregatedGaps: sortedAggregatedGaps,
      employeeDetails: employeeAnalysis
    };
  } catch (error) {
    console.error("Error analyzing skill gaps:", error);
    return {
      success: false as const,
      message: "Failed to analyze skill gaps",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Service to get skills for an employee
export async function getEmployeeSkills(employeeId: number) {
  try {
    // Verify employee exists
    const employeeExists = await db.select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    
    if (employeeExists.length === 0) {
      return { 
        success: false as const,
        message: "Employee not found" 
      };
    }
    
    // Get employee skills with detailed info
    const employeeSkillsData = await db.select({
      id: employeeSkills.id,
      skillId: employeeSkills.skillId,
      skillName: skills.name,
      description: skills.description,
      category: skills.category,
      proficiencyLevel: employeeSkills.proficiencyLevel,
      certified: employeeSkills.certified,
      certificationDate: employeeSkills.certificationDate,
      certificationExpiry: employeeSkills.certificationExpiry,
      lastAssessed: employeeSkills.lastAssessed,
      notes: employeeSkills.notes
    })
    .from(employeeSkills)
    .innerJoin(skills, eq(skills.id, employeeSkills.skillId))
    .where(eq(employeeSkills.employeeId, employeeId));
    
    // Get role requirements for context
    const employeeWithRole = await db.select({
      roleId: employees.roleId
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
    
    let roleRequirements: {skillId:number;skillName:string;requiredLevel:number;importance:string}[] = [];
    if (employeeWithRole.length > 0 && employeeWithRole[0].roleId) {
      roleRequirements = await db.select({
        skillId: roleSkills.skillId,
        skillName: skills.name,
        requiredLevel: roleSkills.requiredProficiencyLevel, importance:roleSkills.importance
      })
      .from(roleSkills)
      .innerJoin(skills, eq(skills.id, roleSkills.skillId))
      .where(eq(roleSkills.roleId, employeeWithRole[0].roleId));
    }
    
    // Build a map of required skills for comparison
    const requiredSkillsMap = new Map();
    roleRequirements.forEach(req => {
      requiredSkillsMap.set(req.skillId, req.requiredLevel);
    });
    
    // Add gap information to each skill
    const skillsWithGapInfo = employeeSkillsData.map(skill => {
      const requiredLevel = requiredSkillsMap.get(skill.skillId) || null;
      const gap = requiredLevel !== null ? requiredLevel - skill.proficiencyLevel : null;
      
      return {
        ...skill,
        importance:roleRequirements.find(req=>req.skillId===skill.skillId)?.importance || 'nice_to_have',
        requiredLevel,
        gap: gap && gap > 0 ? gap : null,
        meetRequirement: gap !== null ? gap <= 0 : null
      };
    });
    
    // Find skills that are required but not possessed
    const missingSkills = [];
    if (roleRequirements.length > 0) {
      const existingSkillIds = new Set(skillsWithGapInfo.map(s => s.skillId));
      
      for (const req of roleRequirements) {
        if (!existingSkillIds.has(req.skillId)) {
          missingSkills.push({
            skillId: req.skillId,
            skillName: req.skillName,
            requiredLevel: req.requiredLevel,
            importance:req.importance,
            proficiencyLevel: 0,
            gap: req.requiredLevel,
            meetRequirement: false,
            missing: true
          });
        }
      }
    }
    
    return {
      success: true as const,
      employeeId,
      skillCount: skillsWithGapInfo.length,
      skills: skillsWithGapInfo,
      missingSkills,
      hasAllRequiredSkills: missingSkills.length === 0 && skillsWithGapInfo.every(s => s.gap === null || s.gap <= 0)
    };
  } catch (error) {
    console.error("Error fetching employee skills:", error);
    return {
      success: false as const,
      message: "Failed to fetch employee skills",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Service to recommend training courses based on skill gaps
export async function recommendCourses(employeeId: number) {
  try {
    // First, get the employee's skills and identify gaps
    const skillsResponse = await getEmployeeSkills(employeeId);
    
    if (!skillsResponse.success) {
      return skillsResponse; // Return the error response
    }
    
    // Collect skills that need improvement or are missing
    const skillGaps = [
      ...skillsResponse.skills.filter(skill => skill.gap !== null && skill.gap > 0),
      ...skillsResponse.missingSkills
    ];
    
    if (skillGaps.length === 0) {
      return {
        success: true as const,
        employeeId,
        message: "Employee has no skill gaps that require training",
        recommendations: []
      };
    }
    
    // Get the skill IDs that need improvement
    const skillIdsToImprove = skillGaps.map(skill => skill.skillId);
    
    try {
      // Find relevant training courses
      const courses = await db.select()
        .from(trainingCourses)
        .where(and(
          arrayOverlaps(trainingCourses.skillIds, skillIdsToImprove.map(String)),
          eq(trainingCourses.active, true)
        ));
      
      try {
        // Get courses the employee is already enrolled in or has completed
        const enrolledCourses = await db.select({
          courseId: employeeTraining.courseId,
          status: employeeTraining.status,
          progress: employeeTraining.progress,
          completionDate: employeeTraining.completionDate
        })
        .from(employeeTraining)
        .where(eq(employeeTraining.employeeId, employeeId));
        
        // Create a set of enrolled course IDs
        const enrolledCourseIds = new Set(enrolledCourses.map(course => course.courseId));
        
        // Map courses to skill gaps
        const recommendations = [];
        
        for (const course of courses) {
          // Parse skill IDs from the array stored in the database
          const courseSkillIds = (course.skillIds || []).map(Number);
          
          // Find which skill gaps this course addresses
          const addressedSkills = skillGaps.filter(gap => 
            courseSkillIds.includes(gap.skillId)
          );
          
          if (addressedSkills.length > 0) {
            const enrollmentStatus = enrolledCourseIds.has(course.id) 
              ? enrolledCourses.find(c => c.courseId === course.id)
              : null;
            
            recommendations.push({
              courseId: course.id,
              title: course.title,
              description: course.description,
              provider: course.provider,
              format: course.format,
              level: course.level,
              duration: course.duration,
              cost: course.cost,
              url: course.url,
              addressedSkills: addressedSkills.map(skill => ({
                skillId: skill.skillId,
                skillName: skill.skillName,
                currentLevel: skill.proficiencyLevel,
                requiredLevel: skill.requiredLevel,
                gap: skill.gap
              })),
              alreadyEnrolled: !!enrollmentStatus,
              enrollmentStatus: enrollmentStatus?.status || null,
              progress: enrollmentStatus?.progress || null,
              completed: enrollmentStatus?.status === 'completed',
              completionDate: enrollmentStatus?.completionDate || null,
              relevanceScore: addressedSkills.reduce((score, skill) => 
                score + (skill.gap || 0) * (skill.importance === 'critical' ? 3 : skill.importance === 'important' ? 2 : 1), 0)
            });
          }
        }
        
        // Sort recommendations by relevance score (most relevant first)
        recommendations.sort((a, b) => {
          // First prioritize courses the employee is not already enrolled in
          if (a.alreadyEnrolled !== b.alreadyEnrolled) {
            return a.alreadyEnrolled ? 1 : -1;
          }
          // If both enrolled or both not enrolled, sort by relevance score
          return b.relevanceScore - a.relevanceScore;
        });
        
        return {
          success: true as const,
          employeeId,
          skillGaps,
          recommendationCount: recommendations.length,
          recommendations
        };
      } catch (enrollmentErr) {
        // If the employeeTraining table doesn't exist
        if (errorMessage(enrollmentErr) && errorMessage(enrollmentErr).includes('relation "employee_training" does not exist')) {
          // Create recommendations without enrollment information
          const recommendations = [];
          
          for (const course of courses) {
            // Parse skill IDs from the array stored in the database
            const courseSkillIds = (course.skillIds || []).map(Number);
            
            // Find which skill gaps this course addresses
            const addressedSkills = skillGaps.filter(gap => 
              courseSkillIds.includes(gap.skillId)
            );
            
            if (addressedSkills.length > 0) {
              recommendations.push({
                courseId: course.id,
                title: course.title,
                description: course.description,
                provider: course.provider,
                format: course.format,
                level: course.level,
                duration: course.duration,
                cost: course.cost,
                url: course.url,
                addressedSkills: addressedSkills.map(skill => ({
                  skillId: skill.skillId,
                  skillName: skill.skillName,
                  currentLevel: skill.proficiencyLevel,
                  requiredLevel: skill.requiredLevel,
                  gap: skill.gap
                })),
                alreadyEnrolled: false, // Default to not enrolled since table doesn't exist
                enrollmentStatus: null,
                progress: null,
                completed: false,
                completionDate: null,
                relevanceScore: addressedSkills.reduce((score, skill) => 
                  score + (skill.gap || 0) * (skill.importance === 'critical' ? 3 : skill.importance === 'important' ? 2 : 1), 0)
              });
            }
          }
          
          // Sort recommendations by relevance score (most relevant first)
          recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);
          
          return {
            success: true as const,
            employeeId,
            skillGaps,
            message: "Employee training table not initialized yet. You'll need to run the db:push command to create the required tables.",
            recommendationCount: recommendations.length,
            recommendations
          };
        }
        throw enrollmentErr; // Re-throw if it's a different error
      }
    } catch (courseErr) {
      // If the trainingCourses table doesn't exist
      if (errorMessage(courseErr) && errorMessage(courseErr).includes('relation "training_courses" does not exist')) {
        return {
          success: true as const,
          employeeId,
          skillGaps,
          message: "Training courses table not initialized yet. You'll need to run the db:push command to create the required tables.",
          recommendationCount: 0,
          recommendations: []
        };
      }
      throw courseErr; // Re-throw if it's a different error
    }
  } catch (error) {
    console.error("Error recommending courses:", error);
    return {
      success: false as const,
      message: "Failed to recommend courses",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// LMS integration service - connects to external LMS or uses internal training course data
export async function getLMSCourses() {
  try {
    // Check if we need to create the tables first (initial setup)
    try {
      // This would be replaced with an actual API call to the LMS
      // For now, we're using the courses from our own database
      const courses = await db.select()
        .from(trainingCourses)
        .where(eq(trainingCourses.active, true));
      
      return {
        success: true as const,
        totalCourses: courses.length,
        courses: courses.map(course => ({
          id: course.id,
          externalId: course.externalCourseId,
          title: course.title,
          description: course.description,
          provider: course.provider,
          format: course.format,
          level: course.level,
          duration: course.duration,
          url: course.url
        }))
      };
    } catch (dbError) {
      // If the table doesn't exist yet, return empty courses array instead of error
      if (errorMessage(dbError) && errorMessage(dbError).includes('relation "training_courses" does not exist')) {
        return {
          success: true as const,
          message: "Training courses table not initialized yet. You'll need to run the db:push command to create the table.",
          totalCourses: 0,
          courses: []
        };
      }
      throw dbError; // Re-throw if it's a different error
    }
  } catch (error) {
    console.error("Error fetching LMS courses:", error);
    return {
      success: false as const,
      message: "Failed to fetch courses from LMS",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// LMS enrollment service - connects to external LMS for enrollment or uses internal tracking
export async function enrollUserInCourse(employeeId: number, courseId: number) {
  try {
    // Check if employee exists
    const employeeExists = await db.select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    
    if (employeeExists.length === 0) {
      return { 
        success: false as const,
        message: "Employee not found" 
      };
    }
    
    try {
      // Check if course exists
      const courseExists = await db.select({ id: trainingCourses.id })
        .from(trainingCourses)
        .where(eq(trainingCourses.id, courseId))
        .limit(1);
      
      if (courseExists.length === 0) {
        return { 
          success: false as const,
          message: "Course not found" 
        };
      }
      
      // Check if employee is already enrolled
      const existingEnrollment = await db.select()
        .from(employeeTraining)
        .where(and(
          eq(employeeTraining.employeeId, employeeId),
          eq(employeeTraining.courseId, courseId)
        ))
        .limit(1);
      
      if (existingEnrollment.length > 0) {
        return { 
          success: false as const,
          message: "Employee is already enrolled in this course",
          enrollment: existingEnrollment[0]
        };
      }
      
      // In a real implementation, this would make an API call to the LMS
      // to enroll the user in the course
      
      // Record the enrollment in our system
      const [enrollment] = await db.insert(employeeTraining)
        .values({
          employeeId,
          courseId,
          enrollmentDate: new Date(),
          status: 'enrolled',
          progress: 0
        })
        .returning();
      
      return {
        success: true as const,
        message: "Successfully enrolled employee in course",
        enrollment
      };
    } catch (dbError) {
      // If the tables don't exist yet
      if (errorMessage(dbError) && (
          errorMessage(dbError).includes('relation "training_courses" does not exist') ||
          errorMessage(dbError).includes('relation "employee_training" does not exist')
        )) {
        return {
          success: false as const,
          message: "Training tables not initialized yet. You'll need to run the db:push command to create the required tables.",
          error: errorMessage(dbError)
        };
      }
      throw dbError; // Re-throw if it's a different error
    }
  } catch (error) {
    console.error("Error enrolling user in course:", error);
    return {
      success: false as const,
      message: "Failed to enroll employee in course",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// LMS course progress service - connects to external LMS or uses internal tracking
export async function getCourseProgress(employeeId: number, courseId: number) {
  try {
    // Check if employee exists
    const employeeExists = await db.select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    
    if (employeeExists.length === 0) {
      return { 
        success: false as const,
        message: "Employee not found" 
      };
    }
    
    try {
      // In a real implementation, this would make an API call to the LMS
      // to get the user's progress in the course
      
      // For now, we'll return the progress from our database
      const enrollment = await db.select()
        .from(employeeTraining)
        .where(and(
          eq(employeeTraining.employeeId, employeeId),
          eq(employeeTraining.courseId, courseId)
        ))
        .limit(1);
      
      if (enrollment.length === 0) {
        return { 
          success: false as const,
          message: "Employee is not enrolled in this course" 
        };
      }
      
      return {
        success: true as const,
        employeeId,
        courseId,
        enrollmentDate: enrollment[0].enrollmentDate,
        status: enrollment[0].status,
        progress: enrollment[0].progress,
        completionDate: enrollment[0].completionDate,
        score: enrollment[0].score,
        certificateUrl: enrollment[0].certificateUrl,
        feedback: enrollment[0].feedback
      };
    } catch (dbError) {
      // If the tables don't exist yet
      if (errorMessage(dbError) && (
          errorMessage(dbError).includes('relation "employee_training" does not exist')
        )) {
        return {
          success: false as const,
          message: "Training tables not initialized yet. You'll need to run the db:push command to create the required tables.",
          error: errorMessage(dbError)
        };
      }
      throw dbError; // Re-throw if it's a different error
    }
  } catch (error) {
    console.error("Error getting course progress:", error);
    return {
      success: false as const,
      message: "Failed to get course progress",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Service to get skill gap recommendations for a department
export async function getSkillGapRecommendations(departmentId: string) {
  try {
    // First get department skill gaps
    const skillGapsResponse = await analyzeSkillGapsByDepartment(departmentId);
    
    if (!skillGapsResponse.success) {
      return skillGapsResponse; // Return the error response
    }
    
    // Extract skill gaps that need to be addressed
    const aggregatedGaps = skillGapsResponse.aggregatedGaps || [];
    
    if (aggregatedGaps.length === 0) {
      return {
        success: true as const,
        departmentId,
        departmentName: skillGapsResponse.departmentName,
        message: "No skill gaps found for this department",
        recommendations: []
      };
    }
    
    // Get the skill IDs that need improvement across the department
    const skillIdsToImprove = aggregatedGaps.map(gap => gap.skillId);
    
    try {
      // Find relevant training courses that address these skill gaps
      const courses = await db.select()
        .from(trainingCourses)
        .where(and(
          arrayOverlaps(trainingCourses.skillIds, skillIdsToImprove.map(String)),
          eq(trainingCourses.active, true)
        ));
      
      // Map courses to skill gaps and calculate relevance scores
      const recommendations: SkillGapCourseRecommendation[] = [];
      
      for (const course of courses) {
        // Parse skill IDs from the array stored in the database
        const courseSkillIds = (course.skillIds || []).map(Number);
        
        // Find which skill gaps this course addresses
        const addressedGaps = aggregatedGaps.filter(gap => 
          courseSkillIds.includes(gap.skillId)
        );
        
        if (addressedGaps.length > 0) {
          // Calculate relevance score based on number of employees affected
          // and the importance of the skills
          const relevanceScore = addressedGaps.reduce((score, gap) => {
            const importanceMultiplier = 
              gap.importance === 'critical' ? 3 : 
              gap.importance === 'important' ? 2 : 1;
            
            return score + (gap.employeeCount * importanceMultiplier * gap.averageGap);
          }, 0);
          
          recommendations.push({
            courseId: course.id,
            courseName: course.title,
            description: course.description,
            relevanceScore,
            targetedSkills: addressedGaps.length,
            duration: course.duration,
            format: course.format,
            alreadyEnrolled: false // Default, we're looking at department-level recommendations
          });
        }
      }
      
      // Sort recommendations by relevance score (most relevant first)
      recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      return {
        success: true as const,
        departmentId,
        departmentName: skillGapsResponse.departmentName,
        totalEmployees: skillGapsResponse.totalEmployees,
        employeesWithGaps: skillGapsResponse.employeesWithGaps,
        skillGaps: aggregatedGaps,
        recommendationCount: recommendations.length,
        recommendations
      };
    } catch (courseErr) {
      // If the trainingCourses table doesn't exist
      if (errorMessage(courseErr) && errorMessage(courseErr).includes('relation "training_courses" does not exist')) {
        return {
          success: true as const,
          departmentId,
          departmentName: skillGapsResponse.departmentName,
          message: "Training courses table not initialized yet. You'll need to run the db:push command to create the required tables.",
          skillGaps: aggregatedGaps,
          recommendationCount: 0,
          recommendations: []
        };
      }
      throw courseErr; // Re-throw if it's a different error
    }
  } catch (error) {
    console.error("Error getting skill gap recommendations:", error);
    return {
      success: false as const,
      message: "Failed to get skill gap recommendations",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
function errorCode(error:unknown):string { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""; }
function errorMessage(error:unknown):string { return error instanceof Error ? error.message : String(error); }
