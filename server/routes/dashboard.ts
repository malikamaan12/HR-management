import { attendance, documents, leaves, events } from '@shared/schema';
import { employeeScope } from '../services/access';
import { getCompanySettings } from '../services/settings';
import { gte,lte,sql } from 'drizzle-orm';
import express from "express";
import { authenticate } from "../middleware/auth";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { users, employees } from "@shared/schema";

const router = express.Router();
router.get('/stats',authenticate,async(req,res)=>{
 try{const today=new Date().toISOString().slice(0,10),policy=await getCompanySettings(),until=new Date(Date.now()+policy.documentExpiryDays*86400000).toISOString().slice(0,10);
 const [head]=await db.select({count:sql<number>`count(*)`}).from(employees).where(employeeScope(req.user!,'employee_database'));
 const [leave]=await db.select({count:sql<number>`count(*)`}).from(leaves).innerJoin(employees,eq(leaves.employeeId,employees.id)).where(and(employeeScope(req.user!,'leave_absence_management'),eq(leaves.status,'approved'),lte(leaves.startDate,today),gte(leaves.endDate,today)));
 const [document]=await db.select({count:sql<number>`count(*)`}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id)).where(and(employeeScope(req.user!,'compliance_documents'),gte(documents.expiryDate,today),lte(documents.expiryDate,until)));
 const [event]=await db.select({count:sql<number>`count(*)`}).from(events).where(and(eq(events.status,'upcoming'),gte(events.endDate,today)));
 return res.json({employeeCount:Number(head.count),activeLeaves:Number(leave.count),expiringDocuments:Number(document.count),upcomingEvents:Number(event.count)});
 }catch{return res.status(500).json({message:'Unable to load dashboard counts'});}
});

/**
 * Get personalized dashboard data based on user role and employee type
 * GET /api/dashboard/personalized
 */
router.get("/personalized", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    
    // Get user data
    const [user] = await db.select()
      .from(users)
      .where(eq(users.id, userId));
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Get associated employee data if exists
    const [employee] = await db.select()
      .from(employees)
      .where(eq(employees.userId, userId));
    
    // Determine dashboard components based on role and employee type
    const components = [];
    
    // Common components for all users
    components.push({
      id: "profile",
      name: "Profile Overview",
      priority: 1
    });
    
    // Role-based components
    if (userRole === "admin" || userRole === "hr") {
      components.push({
        id: "employee_directory",
        name: "Employee Directory",
        priority: 2
      });
      
      components.push({
        id: "pending_approvals",
        name: "Pending Approvals",
        priority: 3
      });
      
      components.push({
        id: "reports",
        name: "Reports & Analytics",
        priority: 4
      });
    }
    
    if (userRole === "admin" || userRole === "hr" || userRole === "manager" || userRole === "department_head") {
      components.push({
        id: "team_overview",
        name: "Team Overview",
        priority: 2
      });
      
      components.push({
        id: "performance_management",
        name: "Performance Management",
        priority: 5
      });
    }
    
    if (userRole === "finance") {
      components.push({
        id: "payroll_management",
        name: "Payroll Management",
        priority: 2
      });
      
      components.push({
        id: "budget_overview",
        name: "Budget Overview",
        priority: 3
      });
    }
    
    // Employee-specific components
    if (employee) {
      // Add attendance tracking for all employees
      components.push({
        id: "attendance",
        name: "Attendance & Time Tracking",
        priority: employee.type === "temporary" ? 2 : 6
      });
      
      // Add leave management for permanent employees
      if (employee.type === "permanent") {
        components.push({
          id: "leave_management",
          name: "Leave Management",
          priority: 7
        });
        
        components.push({
          id: "documents",
          name: "Documents & Compliance",
          priority: 8
        });
        
        components.push({
          id: "salary_benefits",
          name: "Salary & Benefits",
          priority: 9
        });
      }
      
      // Add event staff assignments for eligible employees or event_staff role
      if (employee.eventStaffEligible || userRole === "temporary_staff") {
        components.push({
          id: "event_assignments",
          name: "Event Assignments",
          priority: employee.type === "temporary" ? 3 : 10
        });
      }
      
      // Skills dashboard for all employees
      components.push({
        id: "skills_training",
        name: "Skills & Training",
        priority: employee.type === "temporary" ? 4 : 11
      });
    }
    
    // Add Communication Hub for all users
    components.push({
      id: "communication_hub",
      name: "Communication Hub",
      priority: employee?.type === "temporary" ? 5 : 12
    });
    
    // Sort components by priority
    components.sort((a, b) => a.priority - b.priority);
    
    // Generate dashboard data
    const dashboardData = {
      user: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        role: user.role,
        email: user.email,
        avatar: user.avatar || null
      },
      employee: employee ? {
        id: employee.id,
        employeeId: employee.employeeId,
        employeeType: employee.type,
        department: employee.department,
        position: employee.position,
        joiningDate: employee.joiningDate
      } : null,
      dashboardComponents: components,
      lastLogin: user.lastLogin || null
    };
    
    res.json({
      success: true,
      dashboard: dashboardData
    });
  } catch (error) {
    console.error("Error fetching personalized dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch personalized dashboard"
    });
  }
});

/**
 * Get employee summary for dashboard
 * GET /api/dashboard/employee-summary
 * For managers and above to see team statistics
 */
router.get("/employee-summary", authenticate, async (req, res) => {
  try {
    const userRole = req.user!.role;
    const userId = req.user!.userId;
    
    // Only certain roles can access this endpoint
    const allowedRoles = ["admin", "hr", "manager", "department_head"];
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource"
      });
    }
    
    // Get the employee record associated with the user
    const [managerEmployee] = await db.select()
      .from(employees)
      .where(eq(employees.userId, userId));
    
    let teamQuery = db.select().from(employees).$dynamic();
    
    // Filter employees based on manager's role and department
    if (userRole === "manager" || userRole === "department_head") {
      if (!managerEmployee) {
        return res.status(404).json({
          success: false,
          message: "Manager employee record not found"
        });
      }
      
      // For department heads, show all employees in their department
      if (userRole === "department_head") {
        teamQuery = teamQuery.where(eq(employees.department, managerEmployee.department));
      } 
      // For regular managers, show only direct reports
      else {
        teamQuery = teamQuery.where(eq(employees.reportingManagerId, managerEmployee.id));
      }
    }
    
    // Execute the query
    const teamEmployees = await teamQuery;
    
    // Count employees by type
    const permanentCount = teamEmployees.filter(e => e.type === "permanent").length;
    const temporaryCount = teamEmployees.filter(e => e.type === "temporary").length;
    const contractCount = teamEmployees.filter(e => e.type === "contract").length;
    
    // Count employees by department
    const departmentCounts: Record<string,number> = {};
    teamEmployees.forEach(employee => {
      const dept = employee.department || "Unassigned";
      departmentCounts[dept] = (departmentCounts[dept] || 0) + 1;
    });
    
    // Convert to array format for easier frontend rendering
    const departmentDistribution = Object.entries(departmentCounts).map(([name, count]) => ({
      name,
      count
    }));
    
    res.json({
      success: true,
      summary: {
        totalEmployees: teamEmployees.length,
        employeeTypes: {
          permanent: permanentCount,
          temporary: temporaryCount,
          contract: contractCount
        },
        departmentDistribution
      }
    });
    
  } catch (error) {
    console.error("Error fetching employee summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch employee summary"
    });
  }
});

export default router;