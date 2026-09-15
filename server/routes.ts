import performanceCycleRoutes from './routes/performance-cycles';
import employeeRecordsRouter from './routes/employeeRecords';
import hrRuleRoutes from './routes/hr-rules';
import lifecycleRoutes from './routes/lifecycle';
import hiringRoutes from './routes/hiring';
import attendanceOperations from './routes/attendance-operations';
import { moduleAccess } from './middleware/moduleAccess';
import multer from 'multer';
import payrollRoutes from './routes/payroll';
import userRoutes from './routes/users';
import settingsRoutes from './routes/settings';
import workforceRoutes from './routes/workforce';
import helpdeskRoutes from './routes/helpdesk';
import timesheetRoutes from './routes/timesheets';
import assignmentReviewRoutes from './routes/assignmentReviews';
import teamOverviewRoutes from './routes/teamOverview';
import { WorkforceError } from './services/workforce';
import attendanceRoutes from './routes/attendance';
import leaveRequestRoutes from './routes/leaveRequests';
import documentRoutes from './routes/documents';
import { employeeScope } from './services/access';
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

import { BulkImportService } from "./services/bulkImport";
import { db } from "./db";
import { bulkImportJobs, leaves, employees, attendance, leaveTypes } from "@shared/schema";
import { eq, and, gte, lte, isNotNull, desc, sql } from 'drizzle-orm';
import notificationsRoutes from "./routes/notifications";
import announcementsRoutes from "./routes/announcements";
import slackRoutes from "./routes/slack";
import anthropicRoutes from "./routes/anthropic";
import { registerPerformanceRoutes } from "./routes/performance";
import reportingRoutes from "./routes/reporting";
import analyticsRoutes from "./routes/analytics";
import mobileRoutes from "./routes/mobile";
import roleManagementRoutes from "./routes/roleManagement";
import trainingRoutes from "./routes/training";
import authRoutes from "./routes/auth";
import dashboardRoutes from "./routes/dashboard";
import recruitmentRoutes from "./routes/recruitment";
import onboardingRoutes from "./routes/onboarding";
import employeeRoutes from "./routes/employee";
import cookieParser from "cookie-parser";
import { authenticate, authorize, logApiAccess } from "./middleware/auth";
import { addDataFiltering } from "./middleware/dataFilter";
import { 
  insertUserSchema, 
  insertEmployeeSchema, 
  insertDocumentSchema,
  insertAttendanceSchema,
  insertLeaveSchema,
  insertPayrollSchema,
  insertEventSchema,
  insertEventRoleSchema,
  insertEventStaffProfileSchema,
  insertEventRosterSchema,
  insertEventStaffAssignmentSchema,
  insertEventStaffPerformanceSchema,
  insertEventCommunicationSchema,
  insertEventCommunicationRecipientSchema,
  insertActivityLogSchema,
  insertShiftScheduleSchema,
  insertGeofenceSchema,
  insertLeaveTypeSchema,
  insertLeaveBalanceSchema,
  insertLeaveSupportingDocumentSchema,
  insertLeaveApprovalSchema
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";

export async function registerRoutes(app: Express): Promise<Server> {
  // Add cookie parser middleware
  app.use(cookieParser());
  
  // Register auth routes
  app.use('/api/auth', authRoutes);
  app.use('/api/mobile', mobileRoutes);
  
  // Register dashboard routes
  app.use('/api/dashboard', dashboardRoutes);
  
  app.use('/api',authenticate,moduleAccess);

  // Register recruitment routes
  app.use('/api', authenticate, recruitmentRoutes);
  app.use('/api', authenticate, onboardingRoutes);
  
  // Register employee routes
  app.use('/api/employee', authenticate, employeeRoutes);
  
  // Use authentication middleware for API access logs
  app.use('/api', authenticate, logApiAccess);
  app.use('/api/admin/users',userRoutes);
  app.use('/api/settings',settingsRoutes);
  app.use('/api/hr-rules',hrRuleRoutes);
  app.use('/api/lifecycle',lifecycleRoutes);
  app.use('/api/hiring',hiringRoutes);
  app.use('/api/attendance-operations',attendanceOperations);
  app.use('/api/workforce',workforceRoutes);
  app.use('/api/helpdesk',helpdeskRoutes);
  app.use('/api/review-cycles',performanceCycleRoutes);
  app.use('/api/timesheets',timesheetRoutes);
  app.use('/api/assignment-reviews',assignmentReviewRoutes);
  app.use('/api/team-overview',teamOverviewRoutes);

  // User Routes
  app.get('/api/users/:id', authorize(['admin', 'super_admin']), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      const { id: userId, username, email, firstName, lastName, role, department, isActive, approvalStatus } = user;
      const userData = {id:userId,username,email,firstName,lastName,role,department,isActive,approvalStatus};
      res.status(200).json(userData);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting user', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.use('/api/users', userRoutes);

  app.use('/api/employees', employeeRecordsRouter);

  app.use('/api/documents',documentRoutes);
  app.get('/api/employees/:id/documents',async(req,res)=>{
    try{const id=z.coerce.number().int().positive().parse(req.params.id);
      const [employee]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,id),employeeScope(req.user!,'compliance_documents')));
      if(!employee)return res.status(404).json({message:'Employee not found'});
      return res.json(await storage.getDocuments(id));
    }catch{return res.status(400).json({message:'Unable to load employee documents'});}
  });

  app.use('/api/attendance',attendanceRoutes);

  app.use('/api/leaves',leaveRequestRoutes);
  // Leave Routes


  
  // New Leave API Routes
  
  
  app.get('/api/employees/:employeeId/leaves', async (req: Request, res: Response) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const leaves = await storage.getLeaves(employeeId);
      res.status(200).json(leaves);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting employee leaves', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Get all leaves endpoint
  
  
  app.get('/api/employees/:employeeId/leaves/date-range', async (req: Request, res: Response) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      
      const leaves = await storage.getLeavesByDateRange(employeeId, startDate, endDate);
      res.status(200).json(leaves);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting leaves by date range', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Leave Types API Routes
  
  app.get('/api/leave-types', async (req: Request, res: Response) => {
    try {
      const leaveTypes = await storage.getLeaveTypes();
      res.status(200).json(leaveTypes);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting leave types', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/leave-types/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const leaveType = await storage.getLeaveType(id);
      
      if (!leaveType) {
        return res.status(404).json({ message: 'Leave type not found' });
      }
      
      res.status(200).json(leaveType);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting leave type details', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/leave-types', async (req: Request, res: Response) => {
    try {
      const leaveTypeData = insertLeaveTypeSchema.parse(req.body);
      const newLeaveType = await storage.createLeaveType(leaveTypeData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Created new leave type: ${newLeaveType.name}`,
        entityType: 'leave_type',
        entityId: newLeaveType.id
      });
      
      res.status(201).json(newLeaveType);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid leave type data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating leave type', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.patch('/api/leave-types/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const leaveTypeData = req.body;
      
      // Check if the leave type exists
      const leaveType = await storage.getLeaveType(id);
      if (!leaveType) {
        return res.status(404).json({ message: 'Leave type not found' });
      }
      
      const updatedLeaveType = await storage.updateLeaveType(id, leaveTypeData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'update',
        details: `Updated leave type: ${leaveType.name}`,
        entityType: 'leave_type',
        entityId: id
      });
      
      res.status(200).json(updatedLeaveType);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid leave type data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error updating leave type', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Leave Balances API Routes
  
  app.get('/api/employees/:employeeId/leave-balances', async (req: Request, res: Response) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const leaveBalances = await storage.getLeaveBalances(employeeId);
      res.status(200).json(leaveBalances);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting employee leave balances', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/leave-balances/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const leaveBalance = await storage.getLeaveBalance(id);
      
      if (!leaveBalance) {
        return res.status(404).json({ message: 'Leave balance not found' });
      }
      
      res.status(200).json(leaveBalance);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting leave balance details', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/leave-balances', async (req: Request, res: Response) => {
    try {
      const leaveBalanceData = insertLeaveBalanceSchema.parse(req.body);
      const newLeaveBalance = await storage.createLeaveBalance(leaveBalanceData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Created leave balance for employee #${newLeaveBalance.employeeId}, leave type #${newLeaveBalance.leaveTypeId}`,
        entityType: 'leave_balance',
        entityId: newLeaveBalance.id
      });
      
      res.status(201).json(newLeaveBalance);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid leave balance data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating leave balance', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.patch('/api/leave-balances/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const leaveBalanceData = req.body;
      
      // Check if the leave balance exists
      const leaveBalance = await storage.getLeaveBalance(id);
      if (!leaveBalance) {
        return res.status(404).json({ message: 'Leave balance not found' });
      }
      
      const updatedLeaveBalance = await storage.updateLeaveBalance(id, leaveBalanceData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'update',
        details: `Updated leave balance for employee #${leaveBalance.employeeId}, leave type #${leaveBalance.leaveTypeId}`,
        entityType: 'leave_balance',
        entityId: id
      });
      
      res.status(200).json(updatedLeaveBalance);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid leave balance data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error updating leave balance', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Leave Supporting Documents API Routes
  
  app.get('/api/leaves/:leaveId/supporting-documents', async (req: Request, res: Response) => {
    try {
      const leaveId = parseInt(req.params.leaveId);
      const documents = await storage.getLeaveSupportingDocuments(leaveId);
      res.status(200).json(documents);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting leave supporting documents', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/leave-supporting-documents', async (req: Request, res: Response) => {
    try {
      const documentData = insertLeaveSupportingDocumentSchema.parse(req.body);
      const newDocument = await storage.createLeaveSupportingDocument(documentData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Uploaded supporting document for leave request #${newDocument.leaveId}`,
        entityType: 'leave_supporting_document',
        entityId: newDocument.id
      });
      
      res.status(201).json(newDocument);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid document data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error uploading leave supporting document', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Leave Approvals API Routes
  
  app.get('/api/leaves/:leaveId/approvals', async (req: Request, res: Response) => {
    try {
      const leaveId = parseInt(req.params.leaveId);
      const approvals = await storage.getLeaveApprovals(leaveId);
      res.status(200).json(approvals);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting leave approvals', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/leave-approvals', async (req: Request, res: Response) => {
    try {
      const approvalData = insertLeaveApprovalSchema.parse(req.body);
      const newApproval = await storage.createLeaveApproval(approvalData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Added approval for leave request #${newApproval.leaveId} by approver #${newApproval.approverId}`,
        entityType: 'leave_approval',
        entityId: newApproval.id
      });
      
      res.status(201).json(newApproval);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid approval data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating leave approval', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.use('/api/payroll',payrollRoutes);

  // Event Routes
  app.post('/api/events', async (req: Request, res: Response) => {
    try {
      const eventData = insertEventSchema.parse({...req.body,createdBy:req.user!.userId});
      const newEvent = await storage.createEvent(eventData);
      
      // Log activity
      await storage.createActivityLog({
        userId: eventData.createdBy,
        action: 'create',
        details: `Created new event: ${newEvent.name}`,
        entityType: 'event',
        entityId: newEvent.id
      });
      
      res.status(201).json(newEvent);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid event data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating event', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/events', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const events = await storage.getEvents(status);
      res.status(200).json(events);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting events', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Event Staff Assignment Routes
  app.post('/api/event-staff-assignments', async (req: Request, res: Response) => {
    try {
      const assignmentData = insertEventStaffAssignmentSchema.parse(req.body);
      const newAssignment = await storage.createEventStaffAssignment(assignmentData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Assigned employee #${newAssignment.employeeId} to event #${newAssignment.eventId}`,
        entityType: 'event_staff_assignment',
        entityId: newAssignment.id
      });
      
      res.status(201).json(newAssignment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid assignment data', error: error.errors });
      }
      if(error instanceof WorkforceError)return res.status(error.status).json({message:error.message});
      res.status(500).json({ message: 'Server error creating staff assignment', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/events/:id/staff', async (req: Request, res: Response) => {
    try {
      const eventId = parseInt(req.params.id);
      const assignments = await storage.getEventStaffAssignments(eventId);
      res.status(200).json(assignments);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event staff assignments', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/event-staff-assignments', async (req: Request, res: Response) => {
    try {
      // Get all assignments - we'll filter on the client side if needed
      const assignments = await storage.getEventStaffAssignments(0);
      res.status(200).json(assignments);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting staff assignments', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/events/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const event = await storage.getEvent(id);
      
      if (!event) {
        return res.status(404).json({ message: 'Event not found' });
      }
      
      res.status(200).json(event);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event details', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.patch('/api/events/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updateSchema = insertEventSchema.partial();
      const eventData = updateSchema.parse(req.body);
      const updatedEvent = await storage.updateEvent(id, eventData);
      
      if (!updatedEvent) {
        return res.status(404).json({ message: 'Event not found' });
      }
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'update',
        details: `Updated event: ${updatedEvent.name}`,
        entityType: 'event',
        entityId: id
      });
      
      res.status(200).json(updatedEvent);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid event data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error updating event', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Event Roles Routes
  app.get('/api/event-roles', async (req: Request, res: Response) => {
    try {
      const eventId = req.query.eventId ? parseInt(req.query.eventId as string) : undefined;
      const roles = await storage.getEventRoles(eventId);
      res.status(200).json(roles);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event roles', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/event-roles/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const role = await storage.getEventRole(id);
      
      if (!role) {
        return res.status(404).json({ message: 'Event role not found' });
      }
      
      res.status(200).json(role);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event role details', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/event-roles', async (req: Request, res: Response) => {
    try {
      const roleData = insertEventRoleSchema.parse(req.body);
      const newRole = await storage.createEventRole(roleData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Created new event role: ${newRole.roleName} for event #${newRole.eventId}`,
        entityType: 'event_role',
        entityId: newRole.id
      });
      
      res.status(201).json(newRole);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid event role data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating event role', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Event Staff Profiles Routes
  app.get('/api/event-staff-profiles', async (req: Request, res: Response) => {
    try {
      const profiles = await storage.getEventStaffProfiles();
      res.status(200).json(profiles);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event staff profiles', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/employees/:employeeId/event-staff-profile', async (req: Request, res: Response) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const profile = await storage.getEventStaffProfileByEmployeeId(employeeId);
      
      if (!profile) {
        return res.status(404).json({ message: 'Event staff profile not found' });
      }
      
      res.status(200).json(profile);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event staff profile', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/event-staff-profiles', async (req: Request, res: Response) => {
    try {
      const profileData = insertEventStaffProfileSchema.parse(req.body);
      const newProfile = await storage.createEventStaffProfile(profileData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Created event staff profile for employee #${newProfile.employeeId}`,
        entityType: 'event_staff_profile',
        entityId: newProfile.id
      });
      
      res.status(201).json(newProfile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid staff profile data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating staff profile', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Event Rosters Routes
  app.get('/api/events/:eventId/rosters', async (req: Request, res: Response) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const rosters = await storage.getEventRosters(eventId);
      res.status(200).json(rosters);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event rosters', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/event-rosters/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const roster = await storage.getEventRoster(id);
      
      if (!roster) {
        return res.status(404).json({ message: 'Event roster not found' });
      }
      
      res.status(200).json(roster);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting event roster details', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/event-rosters', async (req: Request, res: Response) => {
    try {
      const rosterData = insertEventRosterSchema.parse(req.body);
      const newRoster = await storage.createEventRoster(rosterData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Created new roster for event #${newRoster.eventId}: ${newRoster.rosterName}`,
        entityType: 'event_roster',
        entityId: newRoster.id
      });
      
      res.status(201).json(newRoster);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid roster data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating event roster', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/event-rosters/:rosterId/assignments', async (req: Request, res: Response) => {
    try {
      const rosterId = parseInt(req.params.rosterId);
      const roster = await storage.getEventRoster(rosterId);
      if(!roster)return res.status(404).json({message:'Roster not found'});
      const assignments = await storage.getEventRosterAssignments(roster.eventId);
      res.status(200).json(assignments);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting roster assignments', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Event Staff Performance Routes
  app.get('/api/event-staff-performance', async (req: Request, res: Response) => {
    try {
      const eventId = req.query.eventId ? parseInt(req.query.eventId as string) : undefined;
      const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
      
      const performances = await storage.getEventStaffPerformances(eventId, employeeId);
      res.status(200).json(performances);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting performance records', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/event-staff-performance', async (req: Request, res: Response) => {
    try {
      const performanceData = insertEventStaffPerformanceSchema.parse(req.body);
      const newPerformance = await storage.createEventStaffPerformance(performanceData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Recorded performance for assignment #${newPerformance.assignmentId}`,
        entityType: 'event_staff_performance',
        entityId: newPerformance.id
      });
      
      res.status(201).json(newPerformance);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid performance data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error recording performance', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Event Communications Routes
  app.get('/api/events/:eventId/communications', async (req: Request, res: Response) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const communications = await storage.getEventCommunications(eventId);
      res.status(200).json(communications);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting communications', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/event-communications', async (req: Request, res: Response) => {
    try {
      const communicationData = insertEventCommunicationSchema.parse(req.body);
      const newCommunication = await storage.createEventCommunication(communicationData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Sent communication for event #${newCommunication.eventId}: ${newCommunication.subject}`,
        entityType: 'event_communication',
        entityId: newCommunication.id
      });
      
      res.status(201).json(newCommunication);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid communication data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error sending communication', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.get('/api/event-communications/:communicationId/recipients', async (req: Request, res: Response) => {
    try {
      const communicationId = parseInt(req.params.communicationId);
      const recipients = await storage.getEventCommunicationRecipients(communicationId);
      res.status(200).json(recipients);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting communication recipients', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  app.post('/api/event-communication-recipients', async (req: Request, res: Response) => {
    try {
      const recipientData = insertEventCommunicationRecipientSchema.parse(req.body);
      const newRecipient = await storage.createEventCommunicationRecipient(recipientData);
      res.status(201).json(newRecipient);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid recipient data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error adding communication recipient', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Shift Schedule Routes
  app.post('/api/shift-schedules', async (req: Request, res: Response) => {
    try {
      const shiftScheduleData = insertShiftScheduleSchema.parse(req.body);
      const newShiftSchedule = await storage.createShiftSchedule(shiftScheduleData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Created shift schedule for employee #${newShiftSchedule.employeeId} on ${newShiftSchedule.date}`,
        entityType: 'shift_schedule',
        entityId: newShiftSchedule.id
      });
      
      res.status(201).json(newShiftSchedule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid shift schedule data', error: error.errors });
      }
      if(error instanceof WorkforceError)return res.status(error.status).json({message:error.message});
      res.status(500).json({ message: 'Server error creating shift schedule', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/shift-schedules', async (req: Request, res: Response) => {
    try {
      let date: Date | undefined;
      
      if (req.query.date) {
        date = new Date(req.query.date as string);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ message: 'Invalid date format' });
        }
      }
      
      const shiftSchedules = await storage.getShiftSchedules(date);
      res.status(200).json(shiftSchedules);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting shift schedules', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/employees/:id/shift-schedules', async (req: Request, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id);
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      
      if (req.query.startDate) {
        startDate = new Date(req.query.startDate as string);
        if (isNaN(startDate.getTime())) {
          return res.status(400).json({ message: 'Invalid startDate format' });
        }
      }
      
      if (req.query.endDate) {
        endDate = new Date(req.query.endDate as string);
        if (isNaN(endDate.getTime())) {
          return res.status(400).json({ message: 'Invalid endDate format' });
        }
      }
      
      const shiftSchedules = await storage.getEmployeeShiftSchedules(employeeId, startDate, endDate);
      res.status(200).json(shiftSchedules);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting employee shift schedules', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.patch('/api/shift-schedules/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      // Partial validation - only validate the fields that are provided
      const updateData = insertShiftScheduleSchema.partial().parse(req.body);
      const updatedShiftSchedule = await storage.updateShiftSchedule(id, updateData);
      
      if (!updatedShiftSchedule) {
        return res.status(404).json({ message: 'Shift schedule not found' });
      }
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'update',
        details: `Updated shift schedule #${id}`,
        entityType: 'shift_schedule',
        entityId: id
      });
      
      res.status(200).json(updatedShiftSchedule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid shift schedule data', error: error.errors });
      }
      if(error instanceof WorkforceError)return res.status(error.status).json({message:error.message});
      res.status(500).json({ message: 'Server error updating shift schedule', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.delete('/api/shift-schedules/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      // First check if the shift schedule exists
      const shiftSchedule = await storage.getShiftSchedule(id);
      if (!shiftSchedule) {
        return res.status(404).json({ message: 'Shift schedule not found' });
      }
      
      await storage.deleteShiftSchedule(id);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'delete',
        details: `Deleted shift schedule #${id}`,
        entityType: 'shift_schedule',
        entityId: id
      });
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: 'Server error deleting shift schedule', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Geofence Routes
  app.post('/api/geofences', async (req: Request, res: Response) => {
    try {
      const geofenceData = insertGeofenceSchema.parse(req.body);
      const newGeofence = await storage.createGeofence(geofenceData);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'create',
        details: `Created geofence: ${newGeofence.geofenceName}`,
        entityType: 'geofence',
        entityId: newGeofence.id
      });
      
      res.status(201).json(newGeofence);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid geofence data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error creating geofence', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/geofences', async (req: Request, res: Response) => {
    try {
      let active: boolean | undefined;
      
      if (req.query.active !== undefined) {
        active = req.query.active === 'true';
      }
      
      const geofences = await storage.getGeofences(active);
      res.status(200).json(geofences);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting geofences', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/geofences/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const geofence = await storage.getGeofence(id);
      
      if (!geofence) {
        return res.status(404).json({ message: 'Geofence not found' });
      }
      
      res.status(200).json(geofence);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting geofence', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/geofences/lookup/:geofenceId', async (req: Request, res: Response) => {
    try {
      const geofenceId = req.params.geofenceId;
      const geofence = await storage.getGeofenceByGeofenceId(geofenceId);
      
      if (!geofence) {
        return res.status(404).json({ message: 'Geofence not found' });
      }
      
      res.status(200).json(geofence);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting geofence', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.patch('/api/geofences/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      // Partial validation - only validate the fields that are provided
      const updateData = insertGeofenceSchema.partial().parse(req.body);
      const updatedGeofence = await storage.updateGeofence(id, updateData);
      
      if (!updatedGeofence) {
        return res.status(404).json({ message: 'Geofence not found' });
      }
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'update',
        details: `Updated geofence: ${updatedGeofence.geofenceName}`,
        entityType: 'geofence',
        entityId: id
      });
      
      res.status(200).json(updatedGeofence);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid geofence data', error: error.errors });
      }
      res.status(500).json({ message: 'Server error updating geofence', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.delete('/api/geofences/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      // First check if the geofence exists
      const geofence = await storage.getGeofence(id);
      if (!geofence) {
        return res.status(404).json({ message: 'Geofence not found' });
      }
      
      await storage.deleteGeofence(id);
      
      // Log activity
      await storage.createActivityLog({
        userId: req.user!.userId,
        action: 'delete',
        details: `Deleted geofence: ${geofence.geofenceName}`,
        entityType: 'geofence',
        entityId: id
      });
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: 'Server error deleting geofence', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Communication Hub Routes
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/announcements', announcementsRoutes);
  app.use('/api/slack', slackRoutes);
  app.use('/api/anthropic', anthropicRoutes);

  // Performance Management Routes
  registerPerformanceRoutes(app);
  
  // Reports & Analytics Routes
  app.use('/api/reporting', reportingRoutes);
  app.use('/api/analytics', analyticsRoutes);
  
  // Mobile API Routes
  
  // Role & Permission Management Routes
  app.use('/api/role-management', roleManagementRoutes);
  
  // Training & Skills Routes
  app.use('/api/training', trainingRoutes);

  // Initialize services

  const bulkImportService = new BulkImportService();

  // Bulk Import API endpoints
  
  app.use('/api/bulk-import',authorize(['admin','super_admin']));
  app.post('/api/bulk-import/upload',multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:0}}).single('file'),async(req,res)=>{
    try{if(!req.file || !req.file.originalname.toLowerCase().endsWith('.csv'))return res.status(400).json({message:'Choose a CSV file up to 2 MB'});
      const [job]=await db.insert(bulkImportJobs).values({fileName:req.file.originalname,fileUrl:'inline-upload',uploadedBy:req.user!.userId,status:'processing'}).returning();
      const result=await bulkImportService.processBulkImport(job.id,req.file.buffer.toString('utf8'),req.user!.userId);
      return res.json({jobId:job.id,...result});
    }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Import failed'});}
  });

  // Get bulk import job status
  app.get("/api/bulk-import/job/:jobId", async (req, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const job = await bulkImportService.getImportJob(jobId);

      if (!job || job.uploadedBy !== req.user!.userId) {
        return res.status(404).json({ error: "Job not found" });
      }

      res.json(job);
    } catch (error: any) {
      console.error("Error getting bulk import job:", error);
      res.status(500).json({ error: "Failed to get job status" });
    }
  });

  // Get all bulk import jobs for user
  app.get("/api/bulk-import/jobs", async (req, res) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const jobs = await bulkImportService.getImportJobs(userId);
      res.json(jobs);
    } catch (error: any) {
      console.error("Error getting bulk import jobs:", error);
      res.status(500).json({ error: "Failed to get jobs" });
    }
  });

  // Download sample CSV template
  app.get("/api/bulk-import/template", (req, res) => {
    const csvTemplate = `firstName,lastName,email,gender,dateOfBirth,nationality,qidNumber,primaryMobile,residentialAddress,emergencyContactName,emergencyContactNumber,department,position,location,joiningDate,type
John,Smith,john.smith@company.com,male,1990-05-15,American,12345678901,+97412345678,"123 Main St, Doha",Jane Smith,+97412345679,IT,Software Developer,Doha Office,2024-01-15,permanent
Sarah,Johnson,sarah.johnson@company.com,female,1988-03-20,British,12345678902,+97412345680,"456 Oak Ave, Doha",Mark Johnson,+97412345681,HR,HR Manager,Doha Office,2024-02-01,permanent`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employee_import_template.csv"');
    res.send(csvTemplate);
  });

  // Activity Log Routes
  app.get('/api/activity-logs/recent', async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const activityLogs = await storage.getRecentActivityLogs(limit);
      res.status(200).json(activityLogs);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting activity logs', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Recruitment APIs
  app.get('/api/job-requisitions', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const requisitions = await storage.getJobRequisitions(status);
      res.status(200).json(requisitions);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting job requisitions', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/job-requisitions/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const requisition = await storage.getJobRequisition(id);
      if (!requisition) {
        return res.status(404).json({ message: 'Job requisition not found' });
      }
      res.status(200).json(requisition);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting job requisition', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/job-requisitions', async (req: Request, res: Response) => {
    try {
      const requisition = await storage.createJobRequisition(req.body);
      res.status(201).json(requisition);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating job requisition', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/job-requisitions/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedRequisition = await storage.updateJobRequisition(id, req.body);
      if (!updatedRequisition) {
        return res.status(404).json({ message: 'Job requisition not found' });
      }
      res.status(200).json(updatedRequisition);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating job requisition', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/candidates', async (req: Request, res: Response) => {
    try {
      const search = req.query.search as string | undefined;
      const candidates = await storage.getCandidates(search);
      res.status(200).json(candidates);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting candidates', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/candidates/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const candidate = await storage.getCandidate(id);
      if (!candidate) {
        return res.status(404).json({ message: 'Candidate not found' });
      }
      res.status(200).json(candidate);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting candidate', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/candidates', async (req: Request, res: Response) => {
    try {
      const candidate = await storage.createCandidate(req.body);
      res.status(201).json(candidate);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating candidate', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/candidates/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedCandidate = await storage.updateCandidate(id, req.body);
      if (!updatedCandidate) {
        return res.status(404).json({ message: 'Candidate not found' });
      }
      res.status(200).json(updatedCandidate);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating candidate', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/job-applications', async (req: Request, res: Response) => {
    try {
      const requisitionId = req.query.requisitionId ? parseInt(req.query.requisitionId as string) : undefined;
      const candidateId = req.query.candidateId ? parseInt(req.query.candidateId as string) : undefined;
      const status = req.query.status as string | undefined;
      const applications = await storage.getJobApplications(requisitionId, candidateId, status);
      res.status(200).json(applications);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting job applications', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/job-applications/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const application = await storage.getJobApplication(id);
      if (!application) {
        return res.status(404).json({ message: 'Job application not found' });
      }
      res.status(200).json(application);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting job application', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/job-applications', async (req: Request, res: Response) => {
    try {
      const application = await storage.createJobApplication(req.body);
      res.status(201).json(application);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating job application', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/job-applications/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedApplication = await storage.updateJobApplication(id, req.body);
      if (!updatedApplication) {
        return res.status(404).json({ message: 'Job application not found' });
      }
      res.status(200).json(updatedApplication);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating job application', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/interviews', async (req: Request, res: Response) => {
    try {
      const applicationId = req.query.applicationId ? parseInt(req.query.applicationId as string) : undefined;
      const status = req.query.status as string | undefined;
      const interviews = await storage.getInterviews(applicationId, status);
      res.status(200).json(interviews);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting interviews', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/interviews/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const interview = await storage.getInterview(id);
      if (!interview) {
        return res.status(404).json({ message: 'Interview not found' });
      }
      res.status(200).json(interview);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting interview', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/interviews', async (req: Request, res: Response) => {
    try {
      const interview = await storage.createInterview(req.body);
      res.status(201).json(interview);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating interview', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/interviews/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedInterview = await storage.updateInterview(id, req.body);
      if (!updatedInterview) {
        return res.status(404).json({ message: 'Interview not found' });
      }
      res.status(200).json(updatedInterview);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating interview', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/job-offers', async (req: Request, res: Response) => {
    try {
      const applicationId = req.query.applicationId ? parseInt(req.query.applicationId as string) : undefined;
      const status = req.query.status as string | undefined;
      const offers = await storage.getJobOffers(applicationId, status);
      res.status(200).json(offers);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting job offers', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/job-offers/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const offer = await storage.getJobOffer(id);
      if (!offer) {
        return res.status(404).json({ message: 'Job offer not found' });
      }
      res.status(200).json(offer);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting job offer', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/job-offers', async (req: Request, res: Response) => {
    try {
      const offer = await storage.createJobOffer(req.body);
      res.status(201).json(offer);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating job offer', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/job-offers/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedOffer = await storage.updateJobOffer(id, req.body);
      if (!updatedOffer) {
        return res.status(404).json({ message: 'Job offer not found' });
      }
      res.status(200).json(updatedOffer);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating job offer', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Onboarding APIs
  app.get('/api/onboarding-checklists', async (req: Request, res: Response) => {
    try {
      const department = req.query.department as string | undefined;
      const employeeType = req.query.employeeType as string | undefined;
      const checklists = await storage.getOnboardingChecklists(department, employeeType);
      res.status(200).json(checklists);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting onboarding checklists', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/onboarding-checklists/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const checklist = await storage.getOnboardingChecklist(id);
      if (!checklist) {
        return res.status(404).json({ message: 'Onboarding checklist not found' });
      }
      res.status(200).json(checklist);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting onboarding checklist', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/onboarding-checklists', async (req: Request, res: Response) => {
    try {
      const checklist = await storage.createOnboardingChecklist(req.body);
      res.status(201).json(checklist);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating onboarding checklist', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/onboarding-checklists/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedChecklist = await storage.updateOnboardingChecklist(id, req.body);
      if (!updatedChecklist) {
        return res.status(404).json({ message: 'Onboarding checklist not found' });
      }
      res.status(200).json(updatedChecklist);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating onboarding checklist', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/checklist-tasks/:checklistId', async (req: Request, res: Response) => {
    try {
      const checklistId = parseInt(req.params.checklistId);
      const tasks = await storage.getChecklistTasks(checklistId);
      res.status(200).json(tasks);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting checklist tasks', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/checklist-tasks', async (req: Request, res: Response) => {
    try {
      const task = await storage.createChecklistTask(req.body);
      res.status(201).json(task);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating checklist task', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/checklist-tasks/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedTask = await storage.updateChecklistTask(id, req.body);
      if (!updatedTask) {
        return res.status(404).json({ message: 'Checklist task not found' });
      }
      res.status(200).json(updatedTask);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating checklist task', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/employee-onboarding', async (req: Request, res: Response) => {
    try {
      const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
      const status = req.query.status as string | undefined;
      const onboardings = await storage.getEmployeeOnboardings(employeeId, status);
      res.status(200).json(onboardings);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting employee onboarding', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/employee-onboarding/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const onboarding = await storage.getEmployeeOnboarding(id);
      if (!onboarding) {
        return res.status(404).json({ message: 'Employee onboarding not found' });
      }
      res.status(200).json(onboarding);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting employee onboarding', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/employee-onboarding', async (req: Request, res: Response) => {
    try {
      const onboarding = await storage.createEmployeeOnboarding(req.body);
      res.status(201).json(onboarding);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating employee onboarding', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/employee-onboarding/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedOnboarding = await storage.updateEmployeeOnboarding(id, req.body);
      if (!updatedOnboarding) {
        return res.status(404).json({ message: 'Employee onboarding not found' });
      }
      res.status(200).json(updatedOnboarding);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating employee onboarding', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/onboarding-tasks', async (req: Request, res: Response) => {
    try {
      const onboardingId = req.query.onboardingId ? parseInt(req.query.onboardingId as string) : undefined;
      const status = req.query.status as string | undefined;
      const tasks = await storage.getOnboardingTasks(onboardingId, status);
      res.status(200).json(tasks);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting onboarding tasks', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/onboarding-tasks/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getOnboardingTask(id);
      if (!task) {
        return res.status(404).json({ message: 'Onboarding task not found' });
      }
      res.status(200).json(task);
    } catch (error) {
      res.status(500).json({ message: 'Server error getting onboarding task', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/onboarding-tasks', async (req: Request, res: Response) => {
    try {
      const task = await storage.createOnboardingTask(req.body);
      res.status(201).json(task);
    } catch (error) {
      res.status(500).json({ message: 'Server error creating onboarding task', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/onboarding-tasks/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updatedTask = await storage.updateOnboardingTask(id, req.body);
      if (!updatedTask) {
        return res.status(404).json({ message: 'Onboarding task not found' });
      }
      res.status(200).json(updatedTask);
    } catch (error) {
      res.status(500).json({ message: 'Server error updating onboarding task', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
