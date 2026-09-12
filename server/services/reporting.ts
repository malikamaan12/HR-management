import { db } from '../db';
import { eq, and, or, sql, between, gt, lt, desc, asc, count, sum, avg } from 'drizzle-orm';
import { 
  employees, 
  attendance, 
  leaves, 
  documents, 
  events, 
  eventStaffAssignments, eventRoles,
  reportDefinitions,
  reportVisualizations,
  reportSchedules,
  reportExecutionHistory
} from '@shared/schema';
import { formatISO, format, parseISO, differenceInDays } from 'date-fns';

// Employee headcount report
export async function getEmployeeHeadcount(department?: string) {
  try {
    const query = department 
      ? db.select().from(employees).where(eq(employees.department, department))
      : db.select().from(employees);
    
    const employeeData = await query;
    
    // Calculate total and breakdown by department
    const total = employeeData.length;
    
    const departmentCounts = employeeData.reduce((acc, employee) => {
      const dept = employee.department;
      if (!acc[dept]) {
        acc[dept] = 0;
      }
      acc[dept]++;
      return acc;
    }, {} as Record<string, number>);
    
    const byDepartment = Object.entries(departmentCounts).map(([department, count]) => ({
      department,
      count
    }));
    
    // Calculate by employment type
    const typeCounts = employeeData.reduce((acc, employee) => {
      const type = employee.type;
      if (!acc[type]) {
        acc[type] = 0;
      }
      acc[type]++;
      return acc;
    }, {} as Record<string, number>);
    
    const byType = Object.entries(typeCounts).map(([type, count]) => ({
      type,
      count
    }));
    
    return {
      total,
      byDepartment,
      byType
    };
  } catch (error) {
    console.error('Error generating employee headcount report:', error);
    throw error;
  }
}

// Turnover rate report
export async function getTurnoverRate(department?: string, startDate?: Date, endDate?: Date) {
  try {
    const defaultStartDate = new Date();
    defaultStartDate.setMonth(defaultStartDate.getMonth() - 1);
    
    const period = {
      startDate: startDate ? format(startDate, 'yyyy-MM-dd') : format(defaultStartDate, 'yyyy-MM-dd'),
      endDate: endDate ? format(endDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
    };
    
    // Get total employee count
    const employeeQuery = department
      ? db.select().from(employees).where(eq(employees.department, department))
      : db.select().from(employees);
    
    const employeeData = await employeeQuery;
    const totalEmployeeCount = employeeData.length;
    
    // Get terminated employee count in the period
    const terminatedQuery = department
      ? db.select().from(employees)
          .where(
            and(
              eq(employees.department, department),
              eq(employees.status, 'terminated'),
              sql`${employees.terminationDate} >= ${period.startDate}`,
              sql`${employees.terminationDate} <= ${period.endDate}`
            )
          )
      : db.select().from(employees)
          .where(
            and(
              eq(employees.status, 'terminated'),
              sql`${employees.terminationDate} >= ${period.startDate}`,
              sql`${employees.terminationDate} <= ${period.endDate}`
            )
          );
    
    const terminatedData = await terminatedQuery;
    const terminatedCount = terminatedData.length;
    
    // Calculate turnover rate
    const rate = totalEmployeeCount > 0 
      ? Number(((terminatedCount / totalEmployeeCount) * 100).toFixed(2))
      : 0;
    
    return {
      rate,
      period,
      terminatedCount,
      totalEmployeeCount,
      department: department || 'All Departments'
    };
  } catch (error) {
    console.error('Error generating turnover rate report:', error);
    throw error;
  }
}

// Leave utilization report
export async function getLeaveUtilization(department?: string, year: number = new Date().getFullYear()) {
  try {
    const startOfYear = `${year}-01-01`;
    const endOfYear = `${year}-12-31`;
    
    // Get leave data for the year
    const leaveQuery = department
      ? db.select({
          id: leaves.id,
          employeeId: leaves.employeeId,
          leaveType: leaves.leaveType,
          startDate: leaves.startDate,
          endDate: leaves.endDate,
          status: leaves.status,
          department: employees.department
        })
        .from(leaves)
        .innerJoin(employees, eq(leaves.employeeId, employees.id))
        .where(
          and(
            eq(employees.department, department),
            sql`${leaves.startDate} >= ${startOfYear}`,
            sql`${leaves.startDate} <= ${endOfYear}`,
            eq(leaves.status, 'approved')
          )
        )
      : db.select({
          id: leaves.id,
          employeeId: leaves.employeeId,
          leaveType: leaves.leaveType,
          startDate: leaves.startDate,
          endDate: leaves.endDate,
          status: leaves.status,
          department: employees.department
        })
        .from(leaves)
        .innerJoin(employees, eq(leaves.employeeId, employees.id))
        .where(
          and(
            sql`${leaves.startDate} >= ${startOfYear}`,
            sql`${leaves.startDate} <= ${endOfYear}`,
            eq(leaves.status, 'approved')
          )
        );
    
    const leaveData = await leaveQuery;
    
    // Calculate days for each leave
    const leavesWithDuration = leaveData.map(leave => {
      const startDate = new Date(leave.startDate);
      const endDate = new Date(leave.endDate);
      const duration = differenceInDays(endDate, startDate) + 1; // +1 to include both start and end days
      
      return {
        ...leave,
        duration
      };
    });
    
    // Calculate by leave type
    const leaveTypeCounts = leavesWithDuration.reduce((acc, leave) => {
      if (!acc[leave.leaveType]) {
        acc[leave.leaveType] = {
          count: 0,
          totalDays: 0
        };
      }
      
      acc[leave.leaveType].count++;
      acc[leave.leaveType].totalDays += leave.duration;
      
      return acc;
    }, {} as Record<string, { count: number, totalDays: number }>);
    
    const byLeaveType = Object.entries(leaveTypeCounts).map(([type, data]) => ({
      type,
      count: data.count,
      totalDays: data.totalDays
    }));
    
    // Calculate by department if no specific department is specified
    let byDepartment: {department:string;count:number;totalDays:number}[] = [];
    
    if (!department) {
      const departmentCounts = leavesWithDuration.reduce((acc, leave) => {
        if (!acc[leave.department]) {
          acc[leave.department] = {
            count: 0,
            totalDays: 0
          };
        }
        
        acc[leave.department].count++;
        acc[leave.department].totalDays += leave.duration;
        
        return acc;
      }, {} as Record<string, { count: number, totalDays: number }>);
      
      byDepartment = Object.entries(departmentCounts).map(([dept, data]) => ({
        department: dept,
        count: data.count,
        totalDays: data.totalDays
      }));
    }
    
    // Calculate total leaves and days
    const totalLeaves = leavesWithDuration.length;
    const totalDays = leavesWithDuration.reduce((total, leave) => total + leave.duration, 0);
    
    return {
      year,
      totalLeaves,
      totalDays,
      byLeaveType,
      byDepartment: byDepartment.length > 0 ? byDepartment : undefined,
      department: department || 'All Departments'
    };
  } catch (error) {
    console.error('Error generating leave utilization report:', error);
    throw error;
  }
}

// Event staff cost report
export async function getEventStaffCost(eventId?: number, startDate?: Date, endDate?: Date) {
  try {
    // Default date range: last 30 days
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);
    
    const period = {
      startDate: startDate ? format(startDate, 'yyyy-MM-dd') : format(defaultStartDate, 'yyyy-MM-dd'),
      endDate: endDate ? format(endDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
    };
    
    // Build query based on parameters
    let query = db.select({
        eventId: events.id,
        eventName: events.name,
        assignmentId: eventStaffAssignments.id,
        employeeId: eventStaffAssignments.employeeId,
        role: eventStaffAssignments.role,
        hourlyRate: eventRoles.hourlyRate,
        hoursWorked: sql<number>`greatest(0,extract(epoch from (${eventStaffAssignments.endTime} - ${eventStaffAssignments.startTime}))/3600)`,
        totalCost: sql`${eventRoles.hourlyRate} * ${sql<number>`greatest(0,extract(epoch from (${eventStaffAssignments.endTime} - ${eventStaffAssignments.startTime}))/3600)`}`
      })
      .from(eventStaffAssignments)
      .innerJoin(events, eq(eventStaffAssignments.eventId, events.id))
      .leftJoin(eventRoles,and(eq(eventRoles.eventId,events.id),eq(eventRoles.roleName,eventStaffAssignments.role))).$dynamic();
    
    // Add filters
    const conditions = [];
    
    if (eventId) {
      conditions.push(eq(events.id, eventId));
    }
    
    conditions.push(sql`${events.startDate} >= ${period.startDate}`);
    conditions.push(sql`${events.endDate} <= ${period.endDate}`);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    const assignmentsData = await query;
    
    // Calculate total cost
    let totalCost = 0;
    for (const assignment of assignmentsData) {
      totalCost += Number(assignment.totalCost);
    }
    
    // Group costs by event
    const eventCosts: Record<number, { 
      eventId: number,
      eventName: string,
      totalCost: number,
      assignmentCount: number,
      uniqueEmployees: Set<number>
    }> = {};
    
    for (const assignment of assignmentsData) {
      if (!eventCosts[assignment.eventId]) {
        eventCosts[assignment.eventId] = {
          eventId: assignment.eventId,
          eventName: assignment.eventName,
          totalCost: 0,
          assignmentCount: 0,
          uniqueEmployees: new Set()
        };
      }
      
      eventCosts[assignment.eventId].totalCost += Number(assignment.totalCost);
      eventCosts[assignment.eventId].assignmentCount++;
      eventCosts[assignment.eventId].uniqueEmployees.add(assignment.employeeId);
    }
    
    // Format output
    const eventSummaries = Object.values(eventCosts).map(event => ({
      eventId: event.eventId,
      eventName: event.eventName,
      totalCost: event.totalCost,
      assignmentCount: event.assignmentCount,
      employeeCount: event.uniqueEmployees.size
    }));
    
    return {
      period,
      totalCost,
      costBasis: 'Scheduled hours and configured role rates; estimates, not paid payroll',
      unpricedAssignments: assignmentsData.filter(row=>row.hourlyRate === null).length,
      eventCount: eventSummaries.length,
      events:eventSummaries
    };
  } catch (error) {
    console.error('Error generating event staff cost report:', error);
    throw error;
  }
}

// Compliance status report
export async function getComplianceStatus() {
  try {
    // Get document status
    const documentData = await db.select({
      id: documents.id,
      employeeId: documents.employeeId,
      documentType: documents.documentType,
      status: documents.status,
      expiryDate: documents.expiryDate
    })
    .from(documents);
    
    // Get employee data to include in the report
    const employeeData = await db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      email: employees.workEmail
    })
    .from(employees);
    
    // Create a map of employees for easy lookup
    const employeeMap = new Map();
    employeeData.forEach(emp => {
      employeeMap.set(emp.id, emp);
    });
    
    // Get counts of documents by status
    const statusCounts = documentData.reduce((acc, doc) => {
      if (!acc[doc.status]) {
        acc[doc.status] = 0;
      }
      acc[doc.status]++;
      return acc;
    }, {} as Record<string, number>);
    
    // Find expired and expiring soon documents
    const expired = documentData.filter(doc => doc.status === 'expired');
    const expiringSoon = documentData.filter(doc => doc.status === 'expiring_soon');
    
    // Add employee details to documents
    const expiredWithDetails = expired.map(doc => {
      const employee = employeeMap.get(doc.employeeId);
      return {
        ...doc,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
        department: employee ? employee.department : 'Unknown',
        email: employee ? employee.workEmail : 'Unknown'
      };
    });
    
    const expiringSoonWithDetails = expiringSoon.map(doc => {
      const employee = employeeMap.get(doc.employeeId);
      return {
        ...doc,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
        department: employee ? employee.department : 'Unknown',
        email: employee ? employee.workEmail : 'Unknown'
      };
    });
    
    // Find employees with compliance issues
    const employeesWithIssues = new Map();
    
    for (const doc of documentData) {
      if (doc.status === 'expired' || doc.status === 'expiring_soon') {
        if (!employeesWithIssues.has(doc.employeeId)) {
          const employee = employeeMap.get(doc.employeeId);
          employeesWithIssues.set(doc.employeeId, {
            id: doc.employeeId,
            name: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
            department: employee ? employee.department : 'Unknown',
            email: employee ? employee.workEmail : 'Unknown',
            issues: []
          });
        }
        
        employeesWithIssues.get(doc.employeeId).issues.push({
          documentType: doc.documentType,
          status: doc.status,
          expiryDate: doc.expiryDate
        });
      }
    }
    
    return {
      summary: {
        total: documentData.length,
        valid: statusCounts['valid'] || 0,
        expired: statusCounts['expired'] || 0,
        expiringSoon: statusCounts['expiring_soon'] || 0,
        employeesWithIssues: employeesWithIssues.size
      },
      expiredDocuments: expiredWithDetails,
      expiringSoonDocuments: expiringSoonWithDetails,
      employees: Array.from(employeesWithIssues.values())
    };
  } catch (error) {
    console.error('Error generating compliance status report:', error);
    throw error;
  }
}

// Dashboard summary stats
export async function getDashboardStats() {
  try {
    // Get employee count
    const employeeCount = await db.select({ count: count() }).from(employees);
    
    // Get active leaves count
    const today = format(new Date(), 'yyyy-MM-dd');
    const activeLeaves = await db.select({ count: count() })
      .from(leaves)
      .where(
        and(
          sql`${leaves.startDate} <= ${today}`,
          sql`${leaves.endDate} >= ${today}`,
          eq(leaves.status, 'approved')
        )
      );
    
    // Get upcoming events
    const upcomingEvents = await db.select({ count: count() })
      .from(events)
      .where(
        and(
          sql`${events.startDate} >= ${today}`,
          eq(events.status, 'upcoming')
        )
      );
    
    // Get document compliance
    const expiringDocuments = await db.select({ count: count() })
      .from(documents)
      .where(
        or(
          eq(documents.status, 'expired'),
          eq(documents.status, 'expiring_soon')
        )
      );
    
    // Return stats
    return {
      employeeCount: employeeCount[0]?.count || 0,
      activeLeaves: activeLeaves[0]?.count || 0,
      upcomingEvents: upcomingEvents[0]?.count || 0,
      expiringDocuments: expiringDocuments[0]?.count || 0
    };
  } catch (error) {
    console.error('Error generating dashboard stats:', error);
    throw error;
  }
}

// Report definition endpoints
export async function getReportDefinitions(userId?: number, isPublic: boolean = false) {
  try {
    let query = db.select().from(reportDefinitions).$dynamic();
    
    if (userId) {
      query = query.where(eq(reportDefinitions.createdBy, userId));
    } else if (isPublic) {
      query = query.where(eq(reportDefinitions.isPublic, true));
    }
    
    return await query.orderBy(desc(reportDefinitions.updatedAt));
  } catch (error) {
    console.error('Error retrieving report definitions:', error);
    throw error;
  }
}

export async function getReportDefinition(id: number) {
  try {
    const [report] = await db.select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, id));
    
    return report;
  } catch (error) {
    console.error('Error retrieving report definition:', error);
    throw error;
  }
}

export async function createReportDefinition(data: any) {
  try {
    const [report] = await db.insert(reportDefinitions)
      .values({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();
    
    return report;
  } catch (error) {
    console.error('Error creating report definition:', error);
    throw error;
  }
}

export async function updateReportDefinition(id: number, data: any) {
  try {
    const [updated] = await db.update(reportDefinitions)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(reportDefinitions.id, id))
      .returning();
    
    return updated;
  } catch (error) {
    console.error('Error updating report definition:', error);
    throw error;
  }
}

export async function deleteReportDefinition(id: number) {
  try {
    await db.delete(reportDefinitions)
      .where(eq(reportDefinitions.id, id));
    
    return true;
  } catch (error) {
    console.error('Error deleting report definition:', error);
    throw error;
  }
}

// Report visualization endpoints
export async function getReportVisualizations(reportId?: number) {
  try {
    let query = db.select().from(reportVisualizations).$dynamic();
    
    if (reportId) {
      query = query.where(eq(reportVisualizations.reportId, reportId));
    }
    
    return await query.orderBy(asc(reportVisualizations.sortOrder));
  } catch (error) {
    console.error('Error retrieving report visualizations:', error);
    throw error;
  }
}

export async function createReportVisualization(data: any) {
  try {
    const [visualization] = await db.insert(reportVisualizations)
      .values({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();
    
    return visualization;
  } catch (error) {
    console.error('Error creating report visualization:', error);
    throw error;
  }
}

export async function updateReportVisualization(id: number, data: any) {
  try {
    const [updated] = await db.update(reportVisualizations)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(reportVisualizations.id, id))
      .returning();
    
    return updated;
  } catch (error) {
    console.error('Error updating report visualization:', error);
    throw error;
  }
}

export async function deleteReportVisualization(id: number) {
  try {
    await db.delete(reportVisualizations)
      .where(eq(reportVisualizations.id, id));
    
    return true;
  } catch (error) {
    console.error('Error deleting report visualization:', error);
    throw error;
  }
}

// Report schedule endpoints
export async function getReportSchedules(reportId?: number) {
  try {
    let query = db.select().from(reportSchedules).$dynamic();
    
    if (reportId) {
      query = query.where(eq(reportSchedules.reportId, reportId));
    }
    
    return await query;
  } catch (error) {
    console.error('Error retrieving report schedules:', error);
    throw error;
  }
}

export async function createReportSchedule(data: any) {
  try {
    const [schedule] = await db.insert(reportSchedules)
      .values({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();
    
    return schedule;
  } catch (error) {
    console.error('Error creating report schedule:', error);
    throw error;
  }
}

export async function updateReportSchedule(id: number, data: any) {
  try {
    const [updated] = await db.update(reportSchedules)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(reportSchedules.id, id))
      .returning();
    
    return updated;
  } catch (error) {
    console.error('Error updating report schedule:', error);
    throw error;
  }
}

export async function deleteReportSchedule(id: number) {
  try {
    await db.delete(reportSchedules)
      .where(eq(reportSchedules.id, id));
    
    return true;
  } catch (error) {
    console.error('Error deleting report schedule:', error);
    throw error;
  }
}

// Report execution history
export async function getReportExecutionHistory(reportId?: number, limit: number = 10) {
  try {
    let query = db.select().from(reportExecutionHistory).$dynamic();
    
    if (reportId) {
      query = query.where(eq(reportExecutionHistory.reportId, reportId));
    }
    
    return await query.orderBy(desc(reportExecutionHistory.executedAt)).limit(limit);
  } catch (error) {
    console.error('Error retrieving execution history:', error);
    throw error;
  }
}

// Execute report
export async function executeReport(reportId: number, userId: number, parameters: any, format?: string) {
  try {
    // Get report definition
    const [report] = await db.select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, reportId));
    
    if (!report) {
      throw new Error(`Report with ID ${reportId} not found`);
    }
    
    if(!report.isPublic && report.createdBy !== userId)throw new Error('Report access denied');
    const definition = report.queryDefinition as {dataSource?:string};
    // Execute the report based on type
    let data;
    
    if (definition.dataSource === 'employees') {
      data = await getEmployeeHeadcount(parameters?.department);
    } else if (definition.dataSource === 'turnover') {
      data = await getTurnoverRate(
        parameters?.department, 
        parameters?.startDate ? new Date(parameters.startDate) : undefined,
        parameters?.endDate ? new Date(parameters.endDate) : undefined
      );
    } else if (definition.dataSource === 'leaves') {
      data = await getLeaveUtilization(
        parameters?.department,
        parameters?.year ? parseInt(parameters.year) : undefined
      );
    } else if (definition.dataSource === 'events') {
      data = await getEventStaffCost(
        parameters?.eventId ? parseInt(parameters.eventId) : undefined,
        parameters?.startDate ? new Date(parameters.startDate) : undefined,
        parameters?.endDate ? new Date(parameters.endDate) : undefined
      );
    } else if (definition.dataSource === 'compliance') {
      data = await getComplianceStatus();
    } else if (definition.dataSource === 'custom') {
      // For custom SQL reports - would need to be carefully implemented with security in mind
      // This is just a placeholder, actual implementation would need proper SQL sanitization
      // data = await db.execute(report.query);
      throw new Error("Choose a supported report data source");
    } else {
      throw new Error("Unknown report type");
    }
    
    // Record the execution
    await db.insert(reportExecutionHistory)
      .values({
        reportId,
        executedBy: userId,
        executedAt: new Date(),
        parameters: JSON.stringify(parameters),
        status: 'success'
      });
    
    // Return the result
    if(format && format !== 'json')throw new Error('Use the CSV export endpoint for downloadable reports');
    return {data};
  } catch (error) {
    console.error('Error executing report:', error);
    
    // Record the failed execution
    await db.insert(reportExecutionHistory)
      .values({
        reportId,
        executedBy: userId,
        executedAt: new Date(),
        parameters: JSON.stringify(parameters),
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });
    
    throw error;
  }
}

// Export report to CSV
export async function exportReportToCsv(reportType: string, filters: any) {
  try {
    // Get report data based on type
    let data;
    let csvContent = '';
    
    if (reportType === 'employee-headcount') {
      data = await getEmployeeHeadcount(filters.department);
      
      // Generate CSV content
      csvContent = 'Department,Count\n';
      data.byDepartment.forEach((dept: { department: string, count: number }) => {
        csvContent += `${dept.department},${dept.count}\n`;
      });
      
      csvContent += '\nEmployment Type,Count\n';
      data.byType.forEach((type: { type: string, count: number }) => {
        csvContent += `${type.type},${type.count}\n`;
      });
      
      csvContent += `\nTotal,${data.total}`;
    } else if (reportType === 'turnover-rate') {
      data = await getTurnoverRate(
        filters.department, 
        filters.startDate ? new Date(filters.startDate) : undefined,
        filters.endDate ? new Date(filters.endDate) : undefined
      );
      
      // Generate CSV content
      csvContent = 'Department,Period,Terminated Employees,Total Employees,Turnover Rate\n';
      csvContent += `${data.department},${data.period.startDate} to ${data.period.endDate},${data.terminatedCount},${data.totalEmployeeCount},${data.rate}%`;
    } else if (reportType === 'leave-utilization') {
      const year = filters.year ? parseInt(filters.year) : new Date().getFullYear();
      data = await getLeaveUtilization(filters.department, year);
      
      // Generate CSV content
      csvContent = 'Leave Type,Count,Total Days\n';
      data.byLeaveType.forEach((leave: { type: string, count: number, totalDays: number }) => {
        csvContent += `${leave.type},${leave.count},${leave.totalDays}\n`;
      });
      
      if (data.byDepartment) {
        csvContent += '\nDepartment,Count,Total Days\n';
        data.byDepartment.forEach((dept: { department: string, count: number, totalDays: number }) => {
          csvContent += `${dept.department},${dept.count},${dept.totalDays}\n`;
        });
      }
      
      csvContent += `\nTotal Leaves,${data.totalLeaves},${data.totalDays}`;
    } else if (reportType === 'event-staff-cost') {
      data = await getEventStaffCost(
        filters.eventId ? parseInt(filters.eventId) : undefined,
        filters.startDate ? new Date(filters.startDate) : undefined,
        filters.endDate ? new Date(filters.endDate) : undefined
      );
      
      // Generate CSV content
      csvContent = 'Event ID,Event Name,Total Cost,Assignment Count,Employee Count\n';
      data.events.forEach((event: { eventId: number, eventName: string, totalCost: number, assignmentCount: number, employeeCount: number }) => {
        csvContent += `${event.eventId},${event.eventName},${event.totalCost},${event.assignmentCount},${event.employeeCount}\n`;
      });
      
      csvContent += `\nTotal Cost,${data.totalCost}`;
    } else if (reportType === 'compliance-status') {
      data = await getComplianceStatus();
      
      // Generate CSV content
      csvContent = 'Summary\n';
      csvContent += `Total Documents,${data.summary.total}\n`;
      csvContent += `Valid Documents,${data.summary.valid}\n`;
      csvContent += `Expired Documents,${data.summary.expired}\n`;
      csvContent += `Expiring Soon Documents,${data.summary.expiringSoon}\n`;
      csvContent += `Employees with Issues,${data.summary.employeesWithIssues}\n\n`;
      
      csvContent += 'Expired Documents\n';
      csvContent += 'Document ID,Employee ID,Employee Name,Department,Document Type,Expiry Date\n';
      data.expiredDocuments.forEach((doc: any) => {
        csvContent += `${doc.id},${doc.employeeId},${doc.employeeName},${doc.department},${doc.documentType},${doc.expiryDate}\n`;
      });
      
      csvContent += '\nExpiring Soon Documents\n';
      csvContent += 'Document ID,Employee ID,Employee Name,Department,Document Type,Expiry Date\n';
      data.expiringSoonDocuments.forEach((doc: any) => {
        csvContent += `${doc.id},${doc.employeeId},${doc.employeeName},${doc.department},${doc.documentType},${doc.expiryDate}\n`;
      });
    }
    
    return csvContent;
  } catch (error) {
    console.error('Error exporting report to CSV:', error);
    throw error;
  }
}