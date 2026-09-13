import { lockEmployee, assertNoWorkforceConflict } from './services/workforce';
import { 
  users, employees, documents, attendance, leaves, payroll, events, eventStaffAssignments, activityLogs,
  jobRequisitions, candidates, jobApplications, interviews, jobOffers,
  onboardingChecklists, checklistTasks, employeeOnboarding, onboardingTasks,
  shiftSchedules, geofences, leaveTypes, leaveBalances, leaveSupportingDocuments, leaveApprovals,
  eventRoles, eventStaffProfiles, eventRosters, eventStaffPerformance, eventCommunications, eventCommunicationRecipients,
  type User, type InsertUser, type Employee, type InsertEmployee, type Document, type InsertDocument,
  type Attendance, type InsertAttendance, type Leave, type InsertLeave, type Payroll, type InsertPayroll,
  type Event, type InsertEvent, type EventStaffAssignment, type InsertEventStaffAssignment, 
  type EventRole, type InsertEventRole, type EventStaffProfile, type InsertEventStaffProfile,
  type EventRoster, type InsertEventRoster, type EventStaffPerformance, type InsertEventStaffPerformance,
  type EventCommunication, type InsertEventCommunication, type EventCommunicationRecipient, type InsertEventCommunicationRecipient,
  type ActivityLog, type InsertActivityLog,
  type JobRequisition, type InsertJobRequisition, type Candidate, type InsertCandidate,
  type JobApplication, type InsertJobApplication, type Interview, type InsertInterview,
  type JobOffer, type InsertJobOffer, type OnboardingChecklist, type InsertOnboardingChecklist,
  type ChecklistTask, type InsertChecklistTask, type EmployeeOnboarding, type InsertEmployeeOnboarding,
  type OnboardingTask, type InsertOnboardingTask,
  type ShiftSchedule, type InsertShiftSchedule, type Geofence, type InsertGeofence,
  type LeaveType, type InsertLeaveType, type LeaveBalance, type InsertLeaveBalance,
  type LeaveSupportingDocument, type InsertLeaveSupportingDocument, type LeaveApproval, type InsertLeaveApproval
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, and, gte, lte, lt, or, desc, sql, SQL } from "drizzle-orm";

export interface IStorage {
  // Database connection
  pool: any; // For direct SQL queries
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  
  // Employee methods
  getEmployee(id: number): Promise<Employee | undefined>;
  getEmployeeByUserId(userId: number): Promise<Employee | undefined>;
  getEmployees(page?: number, limit?: number): Promise<Employee[]>;
  getEmployeesByType(type: string, page?: number, limit?: number): Promise<Employee[]>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: number, employee: Partial<InsertEmployee>): Promise<Employee | undefined>;
  
  // Document methods
  getDocuments(employeeId: number): Promise<Document[]>;
  getExpiringDocuments(daysThreshold: number): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(id: number, document: Partial<InsertDocument>): Promise<Document | undefined>;
  
  // Attendance methods
  getAttendanceByEmployeeAndDate(employeeId: number, date: Date): Promise<Attendance | undefined>;
  getAttendanceByDate(date: Date): Promise<Attendance[]>;
  getAttendanceByDateRange(startDate: Date, endDate: Date): Promise<Attendance[]>;
  createAttendance(attendance: InsertAttendance): Promise<Attendance>;
  updateAttendance(id: number, attendance: Partial<InsertAttendance>): Promise<Attendance | undefined>;
  
  // Shift Schedule methods
  getShiftSchedules(date?: Date): Promise<ShiftSchedule[]>;
  getEmployeeShiftSchedules(employeeId: number, startDate?: Date, endDate?: Date): Promise<ShiftSchedule[]>;
  createShiftSchedule(shiftSchedule: InsertShiftSchedule): Promise<ShiftSchedule>;
  updateShiftSchedule(id: number, shiftSchedule: Partial<InsertShiftSchedule>): Promise<ShiftSchedule | undefined>;
  deleteShiftSchedule(id: number): Promise<void>;
  
  // Geofence methods
  getGeofences(active?: boolean): Promise<Geofence[]>;
  getGeofence(id: number): Promise<Geofence | undefined>;
  getGeofenceByGeofenceId(geofenceId: string): Promise<Geofence | undefined>;
  createGeofence(geofence: InsertGeofence): Promise<Geofence>;
  updateGeofence(id: number, geofence: Partial<InsertGeofence>): Promise<Geofence | undefined>;
  deleteGeofence(id: number): Promise<void>;
  
  // Leave methods
  getLeaves(employeeId: number): Promise<Leave[]>;
  getLeavesByStatus(status: string): Promise<Leave[]>;
  getLeavesByDateRange(employeeId: number, startDate: Date, endDate: Date): Promise<Leave[]>;
  getPendingLeaves(): Promise<Leave[]>;
  getLeave(id: number): Promise<Leave | undefined>;
  createLeave(leave: InsertLeave): Promise<Leave>;
  updateLeaveStatus(id: number, status: string, approvedBy?: number): Promise<Leave | undefined>;
  
  // Leave Types methods
  getLeaveTypes(): Promise<LeaveType[]>;
  getLeaveType(id: number): Promise<LeaveType | undefined>;
  createLeaveType(leaveType: InsertLeaveType): Promise<LeaveType>;
  updateLeaveType(id: number, leaveType: Partial<InsertLeaveType>): Promise<LeaveType | undefined>;
  
  // Leave Balances methods
  getLeaveBalances(employeeId: number): Promise<LeaveBalance[]>;
  getLeaveBalance(id: number): Promise<LeaveBalance | undefined>;
  getLeaveBalanceByType(employeeId: number, leaveTypeId: number): Promise<LeaveBalance | undefined>;
  createLeaveBalance(leaveBalance: InsertLeaveBalance): Promise<LeaveBalance>;
  updateLeaveBalance(id: number, leaveBalance: Partial<InsertLeaveBalance>): Promise<LeaveBalance | undefined>;
  
  // Leave Supporting Documents methods
  getLeaveSupportingDocuments(leaveId: number): Promise<LeaveSupportingDocument[]>;
  createLeaveSupportingDocument(document: InsertLeaveSupportingDocument): Promise<LeaveSupportingDocument>;
  
  // Leave Approvals methods
  getLeaveApprovals(leaveId: number): Promise<LeaveApproval[]>;
  createLeaveApproval(approval: InsertLeaveApproval): Promise<LeaveApproval>;
  
  // Payroll methods
  getPayroll(employeeId: number, month: number, year: number): Promise<Payroll | undefined>;
  getPayrollsByMonth(month: number, year: number): Promise<Payroll[]>;
  createPayroll(payroll: InsertPayroll): Promise<Payroll>;
  updatePayrollStatus(id: number, status: string, processedBy?: number): Promise<Payroll | undefined>;
  
  // Event methods
  getEvent(id: number): Promise<Event | undefined>;
  getEvents(status?: string): Promise<Event[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event | undefined>;
  
  // Event Roles methods
  getEventRoles(eventId?: number): Promise<EventRole[]>;
  getEventRole(id: number): Promise<EventRole | undefined>;
  createEventRole(role: InsertEventRole): Promise<EventRole>;
  updateEventRole(id: number, role: Partial<InsertEventRole>): Promise<EventRole | undefined>;
  
  // Event Staff Profiles methods
  getEventStaffProfiles(): Promise<EventStaffProfile[]>;
  getEventStaffProfile(id: number): Promise<EventStaffProfile | undefined>;
  getEventStaffProfileByEmployeeId(employeeId: number): Promise<EventStaffProfile | undefined>;
  createEventStaffProfile(profile: InsertEventStaffProfile): Promise<EventStaffProfile>;
  updateEventStaffProfile(id: number, profile: Partial<InsertEventStaffProfile>): Promise<EventStaffProfile | undefined>;
  
  // Event Rosters methods
  getEventRosters(eventId: number): Promise<EventRoster[]>;
  getEventRoster(id: number): Promise<EventRoster | undefined>;
  createEventRoster(roster: InsertEventRoster): Promise<EventRoster>;
  updateEventRoster(id: number, roster: Partial<InsertEventRoster>): Promise<EventRoster | undefined>;
  
  // Event Staff Assignment methods
  getEventStaffAssignments(eventId: number): Promise<EventStaffAssignment[]>;
  getEmployeeEventAssignments(employeeId: number): Promise<EventStaffAssignment[]>;
  getEventRosterAssignments(rosterId: number): Promise<EventStaffAssignment[]>;
  createEventStaffAssignment(assignment: InsertEventStaffAssignment): Promise<EventStaffAssignment>;
  updateEventStaffAssignment(id: number, assignment: Partial<InsertEventStaffAssignment>): Promise<EventStaffAssignment | undefined>;
  
  // Event Staff Performance methods
  getEventStaffPerformances(eventId?: number, employeeId?: number): Promise<EventStaffPerformance[]>;
  getEventStaffPerformance(id: number): Promise<EventStaffPerformance | undefined>;
  createEventStaffPerformance(performance: InsertEventStaffPerformance): Promise<EventStaffPerformance>;
  updateEventStaffPerformance(id: number, performance: Partial<InsertEventStaffPerformance>): Promise<EventStaffPerformance | undefined>;
  
  // Event Communication methods
  getEventCommunications(eventId: number): Promise<EventCommunication[]>;
  getEventCommunication(id: number): Promise<EventCommunication | undefined>;
  createEventCommunication(communication: InsertEventCommunication): Promise<EventCommunication>;
  updateEventCommunication(id: number, communication: Partial<InsertEventCommunication>): Promise<EventCommunication | undefined>;
  
  // Event Communication Recipients methods
  getEventCommunicationRecipients(communicationId: number): Promise<EventCommunicationRecipient[]>;
  createEventCommunicationRecipient(recipient: InsertEventCommunicationRecipient): Promise<EventCommunicationRecipient>;
  
  // Activity Log methods
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getRecentActivityLogs(limit?: number): Promise<ActivityLog[]>;
  
  // Recruitment methods
  getJobRequisitions(status?: string): Promise<JobRequisition[]>;
  getJobRequisition(id: number): Promise<JobRequisition | undefined>;
  createJobRequisition(requisition: InsertJobRequisition & Pick<JobRequisition, "requisitionId" | "requestedBy">): Promise<JobRequisition>;
  updateJobRequisition(id: number, requisition: Partial<InsertJobRequisition>): Promise<JobRequisition | undefined>;
  
  getCandidates(search?: string): Promise<Candidate[]>;
  getCandidate(id: number): Promise<Candidate | undefined>;
  createCandidate(candidate: InsertCandidate): Promise<Candidate>;
  updateCandidate(id: number, candidate: Partial<InsertCandidate>): Promise<Candidate | undefined>;
  
  getJobApplications(requisitionId?: number, candidateId?: number, status?: string): Promise<JobApplication[]>;
  getJobApplication(id: number): Promise<JobApplication | undefined>;
  createJobApplication(application: InsertJobApplication): Promise<JobApplication>;
  updateJobApplication(id: number, application: Partial<InsertJobApplication>): Promise<JobApplication | undefined>;
  
  getInterviews(applicationId?: number, status?: string): Promise<Interview[]>;
  getInterview(id: number): Promise<Interview | undefined>;
  createInterview(interview: InsertInterview): Promise<Interview>;
  updateInterview(id: number, interview: Partial<InsertInterview>): Promise<Interview | undefined>;
  
  getJobOffers(applicationId?: number, status?: string): Promise<JobOffer[]>;
  getJobOffer(id: number): Promise<JobOffer | undefined>;
  createJobOffer(offer: InsertJobOffer): Promise<JobOffer>;
  updateJobOffer(id: number, offer: Partial<InsertJobOffer>): Promise<JobOffer | undefined>;
  
  // Onboarding methods
  getOnboardingChecklists(department?: string, employeeType?: string): Promise<OnboardingChecklist[]>;
  getOnboardingChecklist(id: number): Promise<OnboardingChecklist | undefined>;
  createOnboardingChecklist(checklist: InsertOnboardingChecklist): Promise<OnboardingChecklist>;
  updateOnboardingChecklist(id: number, checklist: Partial<InsertOnboardingChecklist>): Promise<OnboardingChecklist | undefined>;
  
  getChecklistTasks(checklistId: number): Promise<ChecklistTask[]>;
  getChecklistTask(id: number): Promise<ChecklistTask | undefined>;
  createChecklistTask(task: InsertChecklistTask): Promise<ChecklistTask>;
  updateChecklistTask(id: number, task: Partial<InsertChecklistTask>): Promise<ChecklistTask | undefined>;
  
  getEmployeeOnboardings(employeeId?: number, status?: string): Promise<EmployeeOnboarding[]>;
  getEmployeeOnboarding(id: number): Promise<EmployeeOnboarding | undefined>;
  createEmployeeOnboarding(onboarding: InsertEmployeeOnboarding): Promise<EmployeeOnboarding>;
  updateEmployeeOnboarding(id: number, onboarding: Partial<InsertEmployeeOnboarding>): Promise<EmployeeOnboarding | undefined>;
  
  getOnboardingTasks(onboardingId?: number, status?: string): Promise<OnboardingTask[]>;
  getOnboardingTask(id: number): Promise<OnboardingTask | undefined>;
  createOnboardingTask(task: InsertOnboardingTask): Promise<OnboardingTask>;
  updateOnboardingTask(id: number, task: Partial<InsertOnboardingTask>): Promise<OnboardingTask | undefined>;
}


export class DatabaseStorage implements IStorage {
  // This property allows direct SQL queries
  pool = pool;
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined> {
    const [updatedUser] = await db.update(users).set(user).where(eq(users.id, id)).returning();
    return updatedUser;
  }

  // Employee records are persisted in PostgreSQL; account IDs are never employee IDs.
  async getEmployee(id: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id));
    return employee;
  }
  async getEmployeeByUserId(userId: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.userId, userId));
    return employee;
  }
  async getEmployees(page = 1, limit = 10): Promise<Employee[]> {
    const size = Math.max(1, Math.min(1000, Number.isFinite(limit) ? Math.trunc(limit) : 10));
    const offset = (Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1) - 1) * size;
    return db.select().from(employees).orderBy(employees.id).limit(size).offset(offset);
  }
  async getEmployeesByType(type: string, page = 1, limit = 10): Promise<Employee[]> {
    if (!['permanent','temporary','contract'].includes(type)) throw new Error('Invalid employee type');
    const size = Math.max(1, Math.min(1000, Number.isFinite(limit) ? Math.trunc(limit) : 10));
    return db.select().from(employees).where(eq(employees.type, type as Employee['type']))
      .orderBy(employees.id).limit(size).offset((Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1)-1)*size);
  }
  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [created] = await db.insert(employees).values(employee).returning();
    return created;
  }
  async updateEmployee(id: number, employee: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [updated] = await db.update(employees).set({ ...employee, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
    return updated;
  }

  // Document methods
  async getDocuments(employeeId: number): Promise<Document[]> {
    return await db.select().from(documents).where(eq(documents.employeeId, employeeId));
  }

  async getExpiringDocuments(daysThreshold: number): Promise<Document[]> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
    return await db.select().from(documents).where(
      and(
        lte(documents.expiryDate, sql`${thresholdDate.toISOString()}`),
        gte(documents.expiryDate, sql`${new Date().toISOString()}`)
      )
    );
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db.insert(documents).values(document).returning();
    return newDocument;
  }

  async updateDocument(id: number, document: Partial<InsertDocument>): Promise<Document | undefined> {
    const [updatedDocument] = await db.update(documents).set(document).where(eq(documents.id, id)).returning();
    return updatedDocument;
  }

  // Attendance methods
  async getAttendanceByEmployeeAndDate(employeeId: number, date: Date): Promise<Attendance | undefined> {
    const formattedDate = date.toISOString().split('T')[0];
    const [attendanceRecord] = await db.select().from(attendance).where(
      and(
        eq(attendance.employeeId, employeeId),
        eq(attendance.date, sql`${formattedDate}`)
      )
    );
    return attendanceRecord;
  }

  async getAttendanceByDate(date: Date): Promise<Attendance[]> {
    const formattedDate = date.toISOString().split('T')[0];
    return await db.select().from(attendance).where(eq(attendance.date, sql`${formattedDate}`));
  }

  async getAttendanceByDateRange(startDate: Date, endDate: Date): Promise<Attendance[]> {
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];
    return await db.select().from(attendance).where(
      and(
        gte(attendance.date, sql`${formattedStartDate}`),
        lte(attendance.date, sql`${formattedEndDate}`)
      )
    );
  }

  async createAttendance(attendanceRecord: InsertAttendance): Promise<Attendance> {
    const [newAttendance] = await db.insert(attendance).values(attendanceRecord).returning();
    return newAttendance;
  }

  async updateAttendance(id: number, attendanceRecord: Partial<InsertAttendance>): Promise<Attendance | undefined> {
    const [updatedAttendance] = await db.update(attendance).set(attendanceRecord).where(eq(attendance.id, id)).returning();
    return updatedAttendance;
  }

  // Leave methods
  async getLeaves(employeeId: number): Promise<Leave[]> {
    return await db.select().from(leaves).where(eq(leaves.employeeId, employeeId));
  }

  async getLeavesByStatus(status: string): Promise<Leave[]> {
    return await db.select().from(leaves).where(sql`${leaves.status}::text = ${status}`);
  }

  async getLeavesByDateRange(employeeId: number, startDate: Date, endDate: Date): Promise<Leave[]> {
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    return await db.select().from(leaves).where(
      and(
        eq(leaves.employeeId, employeeId),
        sql`${leaves.startDate}::date >= ${startDateStr}::date`,
        sql`${leaves.endDate}::date <= ${endDateStr}::date`
      )
    );
  }

  async getPendingLeaves(): Promise<Leave[]> {
    return await db.select().from(leaves).where(sql`${leaves.status}::text = 'pending'`);
  }

  async getLeave(id: number): Promise<Leave | undefined> {
    const [leave] = await db.select().from(leaves).where(eq(leaves.id, id));
    return leave;
  }

  async createLeave(leave: InsertLeave): Promise<Leave> {
    const [newLeave] = await db.insert(leaves).values(leave).returning();
    return newLeave;
  }

  async updateLeaveStatus(id: number, status: string, approvedBy?: number): Promise<Leave | undefined> {
    const updateData: any = { status };
    if (approvedBy) {
      updateData.approvedBy = approvedBy;
      updateData.approvedAt = new Date();
    }
    const [updatedLeave] = await db.update(leaves).set(updateData).where(eq(leaves.id, id)).returning();
    return updatedLeave;
  }

  // Leave Types methods
  async getLeaveTypes(): Promise<LeaveType[]> {
    return await db.select().from(leaveTypes);
  }

  async getLeaveType(id: number): Promise<LeaveType | undefined> {
    const [leaveType] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, id));
    return leaveType;
  }

  async createLeaveType(leaveType: InsertLeaveType): Promise<LeaveType> {
    const [newLeaveType] = await db.insert(leaveTypes).values(leaveType).returning();
    return newLeaveType;
  }

  async updateLeaveType(id: number, leaveType: Partial<InsertLeaveType>): Promise<LeaveType | undefined> {
    const [updatedLeaveType] = await db.update(leaveTypes).set(leaveType).where(eq(leaveTypes.id, id)).returning();
    return updatedLeaveType;
  }

  // Leave Balances methods
  async getLeaveBalances(employeeId: number): Promise<LeaveBalance[]> {
    return await db.select().from(leaveBalances).where(eq(leaveBalances.employeeId, employeeId));
  }

  async getLeaveBalance(id: number): Promise<LeaveBalance | undefined> {
    const [leaveBalance] = await db.select().from(leaveBalances).where(eq(leaveBalances.id, id));
    return leaveBalance;
  }

  async getLeaveBalanceByType(employeeId: number, leaveTypeId: number): Promise<LeaveBalance | undefined> {
    const [leaveBalance] = await db.select().from(leaveBalances).where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId)
      )
    );
    return leaveBalance;
  }

  async createLeaveBalance(leaveBalance: InsertLeaveBalance): Promise<LeaveBalance> {
    const [newLeaveBalance] = await db.insert(leaveBalances).values(leaveBalance).returning();
    return newLeaveBalance;
  }

  async updateLeaveBalance(id: number, leaveBalance: Partial<InsertLeaveBalance>): Promise<LeaveBalance | undefined> {
    const [updatedLeaveBalance] = await db.update(leaveBalances).set(leaveBalance).where(eq(leaveBalances.id, id)).returning();
    return updatedLeaveBalance;
  }

  // Leave Supporting Documents methods
  async getLeaveSupportingDocuments(leaveId: number): Promise<LeaveSupportingDocument[]> {
    return await db.select().from(leaveSupportingDocuments).where(eq(leaveSupportingDocuments.leaveId, leaveId));
  }

  async createLeaveSupportingDocument(document: InsertLeaveSupportingDocument): Promise<LeaveSupportingDocument> {
    const [newDocument] = await db.insert(leaveSupportingDocuments).values(document).returning();
    return newDocument;
  }

  // Leave Approvals methods
  async getLeaveApprovals(leaveId: number): Promise<LeaveApproval[]> {
    return await db.select().from(leaveApprovals).where(eq(leaveApprovals.leaveId, leaveId));
  }

  async createLeaveApproval(approval: InsertLeaveApproval): Promise<LeaveApproval> {
    const [newApproval] = await db.insert(leaveApprovals).values(approval).returning();
    return newApproval;
  }

  // Payroll methods
  async getPayroll(employeeId: number, month: number, year: number): Promise<Payroll | undefined> {
    const [payrollRecord] = await db.select().from(payroll).where(
      and(
        eq(payroll.employeeId, employeeId),
        eq(payroll.month, month),
        eq(payroll.year, year)
      )
    );
    return payrollRecord;
  }

  async getPayrollsByMonth(month: number, year: number): Promise<Payroll[]> {
    return await db.select().from(payroll).where(
      and(
        eq(payroll.month, month),
        eq(payroll.year, year)
      )
    );
  }

  async createPayroll(payrollRecord: InsertPayroll): Promise<Payroll> {
    const [newPayroll] = await db.insert(payroll).values(payrollRecord).returning();
    return newPayroll;
  }

  async updatePayrollStatus(id: number, status: string, processedBy?: number): Promise<Payroll | undefined> {
    const updateData: any = { status };
    if (processedBy) {
      updateData.processedBy = processedBy;
      updateData.processedAt = new Date();
    }
    const [updatedPayroll] = await db.update(payroll).set(updateData).where(eq(payroll.id, id)).returning();
    return updatedPayroll;
  }

  // Event methods
  async getEvent(id: number): Promise<Event | undefined> {
    const [event] = await db.select().from(events).where(eq(events.id, id));
    return event;
  }

  async getEvents(status?: string): Promise<Event[]> {
    return db.select().from(events).where(status ? eq(events.status,status):undefined);
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    const [newEvent] = await db.insert(events).values(event).returning();
    return newEvent;
  }

  async updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event | undefined> {
    const [updatedEvent] = await db.update(events).set(event).where(eq(events.id, id)).returning();
    return updatedEvent;
  }

  // Event Staff Assignment methods
  async getEventStaffAssignments(eventId: number): Promise<EventStaffAssignment[]> {
    return db.select().from(eventStaffAssignments).where(eq(eventStaffAssignments.eventId,eventId));
  }

  async getEmployeeEventAssignments(employeeId: number): Promise<EventStaffAssignment[]> {
    return db.select().from(eventStaffAssignments).where(eq(eventStaffAssignments.employeeId,employeeId));
  }

  async createEventStaffAssignment(assignment: InsertEventStaffAssignment): Promise<EventStaffAssignment> {
    return db.transaction(async tx => {
      await lockEmployee(tx, assignment.employeeId);
      if (!['declined','cancelled','no_show'].includes(assignment.status || 'assigned'))
        await assertNoWorkforceConflict(tx, assignment.employeeId, assignment.startTime, assignment.endTime);
      const [row] = await tx.insert(eventStaffAssignments).values(assignment).returning(); return row;
    });
  }

  async updateEventStaffAssignment(id: number, assignment: Partial<InsertEventStaffAssignment>): Promise<EventStaffAssignment | undefined> {
    return db.transaction(async tx => {
      const [old] = await tx.select().from(eventStaffAssignments).where(eq(eventStaffAssignments.id,id)).for('update');
      if (!old) return undefined;
      const next = {...old, ...assignment}; await lockEmployee(tx, next.employeeId);
      if (!['declined','cancelled','no_show'].includes(next.status)) await assertNoWorkforceConflict(tx,next.employeeId,next.startTime,next.endTime);
      const [row] = await tx.update(eventStaffAssignments).set({...assignment,updatedAt:new Date()}).where(eq(eventStaffAssignments.id,id)).returning(); return row;
    });
  }

  async getEventRosterAssignments(eventId: number, role?: string): Promise<EventStaffAssignment[]> {
    return db.select().from(eventStaffAssignments).where(and(eq(eventStaffAssignments.eventId,eventId),role ? eq(eventStaffAssignments.role,role):undefined));
  }

  async getEventRoles(eventId?: number): Promise<EventRole[]> {
    try {
      if (eventId) {
        return await db.select().from(eventRoles).where(eq(eventRoles.eventId, eventId));
      } else {
        return await db.select().from(eventRoles);
      }
    } catch (error) {
      console.error("Error getting event roles:", error);
      return [];
    }
  }
  
  async getEventRole(id: number): Promise<EventRole | undefined> {
    try {
      const [role] = await db.select().from(eventRoles).where(eq(eventRoles.id, id));
      return role;
    } catch (error) {
      console.error("Error getting event role:", error);
      return undefined;
    }
  }
  
  async createEventRole(role: InsertEventRole): Promise<EventRole> {
    try {
      const [newRole] = await db.insert(eventRoles).values(role).returning();
      return newRole;
    } catch (error) {
      console.error("Error creating event role:", error);
      throw error;
    }
  }
  
  async updateEventRole(id: number, role: Partial<InsertEventRole>): Promise<EventRole | undefined> {
    const [row] = await db.update(eventRoles).set({...role,updatedAt:new Date()}).where(eq(eventRoles.id,id)).returning(); return row;
  }

  async getEventStaffProfiles(): Promise<EventStaffProfile[]> {
    return db.select().from(eventStaffProfiles);
  }

  async getEventStaffProfile(id: number): Promise<EventStaffProfile | undefined> {
    const [row] = await db.select().from(eventStaffProfiles).where(eq(eventStaffProfiles.id,id)); return row;
  }

  async getEventStaffProfileByEmployeeId(employeeId: number): Promise<EventStaffProfile | undefined> {
    const [row] = await db.select().from(eventStaffProfiles).where(eq(eventStaffProfiles.employeeId,employeeId)); return row;
  }

  async createEventStaffProfile(profile: InsertEventStaffProfile): Promise<EventStaffProfile> {
    const [row] = await db.insert(eventStaffProfiles).values(profile).returning(); return row;
  }

  async updateEventStaffProfile(id: number, profile: Partial<InsertEventStaffProfile>): Promise<EventStaffProfile | undefined> {
    const [row] = await db.update(eventStaffProfiles).set({...profile,updatedAt:new Date()}).where(eq(eventStaffProfiles.id,id)).returning(); return row;
  }

  async getEventRosters(eventId: number): Promise<EventRoster[]> {
    return db.select().from(eventRosters).where(eq(eventRosters.eventId,eventId));
  }

  async getEventRoster(id: number): Promise<EventRoster | undefined> {
    const [row] = await db.select().from(eventRosters).where(eq(eventRosters.id,id)); return row;
  }

  async createEventRoster(roster: InsertEventRoster): Promise<EventRoster> {
    const [row] = await db.insert(eventRosters).values(roster).returning(); return row;
  }

  async updateEventRoster(id: number, roster: Partial<InsertEventRoster>): Promise<EventRoster | undefined> {
    const [row] = await db.update(eventRosters).set({...roster,updatedAt:new Date()}).where(eq(eventRosters.id,id)).returning(); return row;
  }

  async getEventStaffPerformances(eventId?: number, employeeId?: number): Promise<EventStaffPerformance[]> {
    const rows = await db.select({performance:eventStaffPerformance}).from(eventStaffPerformance)
      .innerJoin(eventStaffAssignments,eq(eventStaffPerformance.assignmentId,eventStaffAssignments.id))
      .where(and(eventId ? eq(eventStaffAssignments.eventId,eventId):undefined,employeeId ? eq(eventStaffAssignments.employeeId,employeeId):undefined));
    return rows.map(row=>row.performance);
  }

  async getEventStaffPerformance(id: number): Promise<EventStaffPerformance | undefined> {
    const [row] = await db.select().from(eventStaffPerformance).where(eq(eventStaffPerformance.id,id)); return row;
  }

  async createEventStaffPerformance(performance: InsertEventStaffPerformance): Promise<EventStaffPerformance> {
    const [row] = await db.insert(eventStaffPerformance).values(performance).returning(); return row;
  }

  async updateEventStaffPerformance(id: number, performance: Partial<InsertEventStaffPerformance>): Promise<EventStaffPerformance | undefined> {
    const [row] = await db.update(eventStaffPerformance).set({...performance,updatedAt:new Date()}).where(eq(eventStaffPerformance.id,id)).returning(); return row;
  }

  async getEventCommunications(eventId: number): Promise<EventCommunication[]> {
    return db.select().from(eventCommunications).where(eq(eventCommunications.eventId,eventId));
  }

  async getEventCommunication(id: number): Promise<EventCommunication | undefined> {
    const [row] = await db.select().from(eventCommunications).where(eq(eventCommunications.id,id)); return row;
  }

  async createEventCommunication(communication: InsertEventCommunication): Promise<EventCommunication> {
    const [row] = await db.insert(eventCommunications).values(communication).returning(); return row;
  }

  async updateEventCommunication(id: number, communication: Partial<InsertEventCommunication>): Promise<EventCommunication | undefined> {
    const [row] = await db.update(eventCommunications).set({...communication,updatedAt:new Date()}).where(eq(eventCommunications.id,id)).returning(); return row;
  }

  async getEventCommunicationRecipients(communicationId: number): Promise<EventCommunicationRecipient[]> {
    return db.select().from(eventCommunicationRecipients).where(eq(eventCommunicationRecipients.communicationId,communicationId));
  }

  async createEventCommunicationRecipient(recipient: InsertEventCommunicationRecipient): Promise<EventCommunicationRecipient> {
    const [row] = await db.insert(eventCommunicationRecipients).values(recipient).returning(); return row;
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [newLog] = await db.insert(activityLogs).values(log).returning();
    return newLog;
  }

  async getRecentActivityLogs(limit: number = 10): Promise<ActivityLog[]> {
    return await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(limit);
  }

  // Shift Schedule methods
  async getShiftSchedules(date?: Date): Promise<ShiftSchedule[]> {
    if (date) {
      const formattedDate = date.toISOString().split('T')[0];
      return await db.select().from(shiftSchedules).where(eq(shiftSchedules.date, sql`${formattedDate}`));
    }
    return await db.select().from(shiftSchedules);
  }

  async getShiftSchedule(id: number): Promise<ShiftSchedule | undefined> {
    const [shiftSchedule] = await db.select().from(shiftSchedules).where(eq(shiftSchedules.id, id));
    return shiftSchedule;
  }

  async getEmployeeShiftSchedules(employeeId: number, startDate?: Date, endDate?: Date): Promise<ShiftSchedule[]> {
    let conditions = [eq(shiftSchedules.employeeId, employeeId)];
    
    if (startDate && endDate) {
      const formattedStartDate = startDate.toISOString().split('T')[0];
      const formattedEndDate = endDate.toISOString().split('T')[0];
      conditions.push(
        gte(shiftSchedules.date, sql`${formattedStartDate}`),
        lte(shiftSchedules.date, sql`${formattedEndDate}`)
      );
    } else if (startDate) {
      const formattedStartDate = startDate.toISOString().split('T')[0];
      conditions.push(gte(shiftSchedules.date, sql`${formattedStartDate}`));
    }
    
    return await db.select().from(shiftSchedules).where(and(...conditions)).orderBy(shiftSchedules.date);
  }

  async createShiftSchedule(shiftSchedule: InsertShiftSchedule): Promise<ShiftSchedule> {
    return db.transaction(async tx => {
      await lockEmployee(tx,shiftSchedule.employeeId);
      await assertNoWorkforceConflict(tx,shiftSchedule.employeeId,shiftSchedule.startTime,shiftSchedule.endTime);
      const [row] = await tx.insert(shiftSchedules).values(shiftSchedule).returning(); return row;
    });
  }

  async updateShiftSchedule(id: number, shiftSchedule: Partial<InsertShiftSchedule>): Promise<ShiftSchedule | undefined> {
    return db.transaction(async tx => {
      const [old] = await tx.select().from(shiftSchedules).where(eq(shiftSchedules.id,id)).for('update');
      if (!old) return undefined;
      const next = {...old,...shiftSchedule}; await lockEmployee(tx,next.employeeId);
      await assertNoWorkforceConflict(tx,next.employeeId,next.startTime,next.endTime);
      const [row] = await tx.update(shiftSchedules).set(shiftSchedule).where(eq(shiftSchedules.id,id)).returning(); return row;
    });
  }

  async deleteShiftSchedule(id: number): Promise<void> {
    await db.delete(shiftSchedules).where(eq(shiftSchedules.id, id));
  }

  // Geofence methods
  async getGeofences(active?: boolean): Promise<Geofence[]> {
    if (active !== undefined) {
      const today = new Date().toISOString().split('T')[0];
      if (active) {
        // Return geofences that are active today (either no end date or end date >= today)
        return await db.select().from(geofences).where(
          or(
            sql`${geofences.endDate} IS NULL`,
            gte(geofences.endDate, sql`${today}`)
          )
        );
      } else {
        // Return geofences that are not active (end date < today)
        return await db.select().from(geofences).where(
          and(
            sql`${geofences.endDate} IS NOT NULL`,
            lt(geofences.endDate, sql`${today}`)
          )
        );
      }
    }
    return await db.select().from(geofences);
  }

  async getGeofence(id: number): Promise<Geofence | undefined> {
    const [geofence] = await db.select().from(geofences).where(eq(geofences.id, id));
    return geofence;
  }

  async getGeofenceByGeofenceId(geofenceId: string): Promise<Geofence | undefined> {
    const [geofence] = await db.select().from(geofences).where(eq(geofences.geofenceId, geofenceId));
    return geofence;
  }

  async createGeofence(geofence: InsertGeofence): Promise<Geofence> {
    const [newGeofence] = await db.insert(geofences).values(geofence).returning();
    return newGeofence;
  }

  async updateGeofence(id: number, geofence: Partial<InsertGeofence>): Promise<Geofence | undefined> {
    const [updatedGeofence] = await db.update(geofences).set(geofence).where(eq(geofences.id, id)).returning();
    return updatedGeofence;
  }

  async deleteGeofence(id: number): Promise<void> {
    await db.delete(geofences).where(eq(geofences.id, id));
  }

  // Recruitment methods
  async getJobRequisitions(status?: string): Promise<JobRequisition[]> {
    if (status) {
      return await db.select().from(jobRequisitions).where(sql`${jobRequisitions.status}::text = ${status}`);
    }
    return await db.select().from(jobRequisitions);
  }

  async getJobRequisition(id: number): Promise<JobRequisition | undefined> {
    const [requisition] = await db.select().from(jobRequisitions).where(eq(jobRequisitions.id, id));
    return requisition;
  }

  async createJobRequisition(requisition: InsertJobRequisition & Pick<JobRequisition, "requisitionId" | "requestedBy">): Promise<JobRequisition> {
    const [newRequisition] = await db.insert(jobRequisitions).values(requisition).returning();
    return newRequisition;
  }

  async updateJobRequisition(id: number, requisition: Partial<InsertJobRequisition>): Promise<JobRequisition | undefined> {
    const [updatedRequisition] = await db.update(jobRequisitions).set(requisition).where(eq(jobRequisitions.id, id)).returning();
    return updatedRequisition;
  }

  async getCandidates(search?: string): Promise<Candidate[]> {
    if (search) {
      return await db.select().from(candidates).where(
        sql`(${candidates.fullNameEn} ILIKE ${`%${search}%`} OR ${candidates.email} ILIKE ${`%${search}%`})`
      );
    }
    return await db.select().from(candidates);
  }

  async getCandidate(id: number): Promise<Candidate | undefined> {
    const [candidate] = await db.select().from(candidates).where(eq(candidates.id, id));
    return candidate;
  }

  async createCandidate(candidate: InsertCandidate): Promise<Candidate> {
    const [newCandidate] = await db.insert(candidates).values(candidate).returning();
    return newCandidate;
  }

  async updateCandidate(id: number, candidate: Partial<InsertCandidate>): Promise<Candidate | undefined> {
    const [updatedCandidate] = await db.update(candidates).set(candidate).where(eq(candidates.id, id)).returning();
    return updatedCandidate;
  }

  async getJobApplications(requisitionId?: number, candidateId?: number, status?: string): Promise<JobApplication[]> {
    const conditions: SQL[] = [];
    
    if (requisitionId) {
      conditions.push(sql`${jobApplications.requisitionId} = ${requisitionId}`);
    }
    
    if (candidateId) {
      conditions.push(sql`${jobApplications.candidateId} = ${candidateId}`);
    }
    
    if (status) {
      conditions.push(sql`${jobApplications.status}::text = ${status}`);
    }
    
    if (conditions.length > 0) {
      return await db.select().from(jobApplications).where(and(...conditions));
    } else {
      return await db.select().from(jobApplications);
    }
  }

  async getJobApplication(id: number): Promise<JobApplication | undefined> {
    const [application] = await db.select().from(jobApplications).where(eq(jobApplications.id, id));
    return application;
  }

  async createJobApplication(application: InsertJobApplication): Promise<JobApplication> {
    const [newApplication] = await db.insert(jobApplications).values(application).returning();
    return newApplication;
  }

  async updateJobApplication(id: number, application: Partial<InsertJobApplication>): Promise<JobApplication | undefined> {
    const [updatedApplication] = await db.update(jobApplications).set(application).where(eq(jobApplications.id, id)).returning();
    return updatedApplication;
  }

  async getInterviews(applicationId?: number, status?: string): Promise<Interview[]> {
    const conditions: SQL[] = [];
    
    if (applicationId) {
      conditions.push(sql`${interviews.applicationId} = ${applicationId}`);
    }
    
    if (status) {
      conditions.push(sql`${interviews.status}::text = ${status}`);
    }
    
    if (conditions.length > 0) {
      return await db.select().from(interviews).where(and(...conditions));
    } else {
      return await db.select().from(interviews);
    }
  }

  async getInterview(id: number): Promise<Interview | undefined> {
    const [interview] = await db.select().from(interviews).where(eq(interviews.id, id));
    return interview;
  }

  async createInterview(interview: InsertInterview): Promise<Interview> {
    const [newInterview] = await db.insert(interviews).values(interview).returning();
    return newInterview;
  }

  async updateInterview(id: number, interview: Partial<InsertInterview>): Promise<Interview | undefined> {
    const [updatedInterview] = await db.update(interviews).set(interview).where(eq(interviews.id, id)).returning();
    return updatedInterview;
  }

  async getJobOffers(applicationId?: number, status?: string): Promise<JobOffer[]> {
    const conditions: SQL[] = [];
    
    if (applicationId) {
      conditions.push(sql`${jobOffers.applicationId} = ${applicationId}`);
    }
    
    if (status) {
      conditions.push(sql`${jobOffers.status}::text = ${status}`);
    }
    
    if (conditions.length > 0) {
      return await db.select().from(jobOffers).where(and(...conditions));
    } else {
      return await db.select().from(jobOffers);
    }
  }

  async getJobOffer(id: number): Promise<JobOffer | undefined> {
    const [offer] = await db.select().from(jobOffers).where(eq(jobOffers.id, id));
    return offer;
  }

  async createJobOffer(offer: InsertJobOffer): Promise<JobOffer> {
    const [newOffer] = await db.insert(jobOffers).values(offer).returning();
    return newOffer;
  }

  async updateJobOffer(id: number, offer: Partial<InsertJobOffer>): Promise<JobOffer | undefined> {
    const [updatedOffer] = await db.update(jobOffers).set(offer).where(eq(jobOffers.id, id)).returning();
    return updatedOffer;
  }

  // Onboarding methods
  async getOnboardingChecklists(department?: string, employeeType?: string): Promise<OnboardingChecklist[]> {
    const conditions: SQL[] = [];
    
    if (department) {
      conditions.push(sql`${onboardingChecklists.departmentSpecific} = ${department}`);
    }
    
    if (employeeType) {
      conditions.push(sql`${onboardingChecklists.employeeTypeSpecific}::text = ${employeeType}`);
    }
    
    if (conditions.length > 0) {
      return await db.select().from(onboardingChecklists).where(and(...conditions));
    } else {
      return await db.select().from(onboardingChecklists);
    }
  }

  async getOnboardingChecklist(id: number): Promise<OnboardingChecklist | undefined> {
    const [checklist] = await db.select().from(onboardingChecklists).where(eq(onboardingChecklists.id, id));
    return checklist;
  }

  async createOnboardingChecklist(checklist: InsertOnboardingChecklist): Promise<OnboardingChecklist> {
    const [newChecklist] = await db.insert(onboardingChecklists).values(checklist).returning();
    return newChecklist;
  }

  async updateOnboardingChecklist(id: number, checklist: Partial<InsertOnboardingChecklist>): Promise<OnboardingChecklist | undefined> {
    const [updatedChecklist] = await db.update(onboardingChecklists).set(checklist).where(eq(onboardingChecklists.id, id)).returning();
    return updatedChecklist;
  }

  async getChecklistTasks(checklistId: number): Promise<ChecklistTask[]> {
    return await db.select().from(checklistTasks).where(eq(checklistTasks.checklistId, checklistId));
  }

  async getChecklistTask(id: number): Promise<ChecklistTask | undefined> {
    const [task] = await db.select().from(checklistTasks).where(eq(checklistTasks.id, id));
    return task;
  }

  async createChecklistTask(task: InsertChecklistTask): Promise<ChecklistTask> {
    const [newTask] = await db.insert(checklistTasks).values(task).returning();
    return newTask;
  }

  async updateChecklistTask(id: number, task: Partial<InsertChecklistTask>): Promise<ChecklistTask | undefined> {
    const [updatedTask] = await db.update(checklistTasks).set(task).where(eq(checklistTasks.id, id)).returning();
    return updatedTask;
  }

  async getEmployeeOnboardings(employeeId?: number, status?: string): Promise<EmployeeOnboarding[]> {
    const conditions: SQL[] = [];
    
    if (employeeId) {
      conditions.push(sql`${employeeOnboarding.employeeId} = ${employeeId}`);
    }
    
    if (status) {
      conditions.push(sql`${employeeOnboarding.status}::text = ${status}`);
    }
    
    if (conditions.length > 0) {
      return await db.select().from(employeeOnboarding).where(and(...conditions));
    } else {
      return await db.select().from(employeeOnboarding);
    }
  }

  async getEmployeeOnboarding(id: number): Promise<EmployeeOnboarding | undefined> {
    const [onboarding] = await db.select().from(employeeOnboarding).where(eq(employeeOnboarding.id, id));
    return onboarding;
  }

  async createEmployeeOnboarding(onboarding: InsertEmployeeOnboarding): Promise<EmployeeOnboarding> {
    const [newOnboarding] = await db.insert(employeeOnboarding).values(onboarding).returning();
    return newOnboarding;
  }

  async updateEmployeeOnboarding(id: number, onboarding: Partial<InsertEmployeeOnboarding>): Promise<EmployeeOnboarding | undefined> {
    const [updatedOnboarding] = await db.update(employeeOnboarding).set(onboarding).where(eq(employeeOnboarding.id, id)).returning();
    return updatedOnboarding;
  }

  async getOnboardingTasks(onboardingId?: number, status?: string): Promise<OnboardingTask[]> {
    const conditions: SQL[] = [];
    
    if (onboardingId) {
      conditions.push(sql`${onboardingTasks.onboardingId} = ${onboardingId}`);
    }
    
    if (status) {
      conditions.push(sql`${onboardingTasks.status}::text = ${status}`);
    }
    
    if (conditions.length > 0) {
      return await db.select().from(onboardingTasks).where(and(...conditions));
    } else {
      return await db.select().from(onboardingTasks);
    }
  }

  async getOnboardingTask(id: number): Promise<OnboardingTask | undefined> {
    const [task] = await db.select().from(onboardingTasks).where(eq(onboardingTasks.id, id));
    return task;
  }

  async createOnboardingTask(task: InsertOnboardingTask): Promise<OnboardingTask> {
    const [newTask] = await db.insert(onboardingTasks).values(task).returning();
    return newTask;
  }

  async updateOnboardingTask(id: number, task: Partial<InsertOnboardingTask>): Promise<OnboardingTask | undefined> {
    const [updatedTask] = await db.update(onboardingTasks).set(task).where(eq(onboardingTasks.id, id)).returning();
    return updatedTask;
  }
}

export const storage = new DatabaseStorage();
