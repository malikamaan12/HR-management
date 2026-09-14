import { relations, sql } from "drizzle-orm";
import { type AnyPgColumn, pgTable, text, serial, integer, boolean, timestamp, pgEnum, varchar, date, json, decimal, jsonb, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Workforce operations keep employment type on the existing employee profile.
export const workforceKind = pgEnum('workforce_kind', ['event', 'fec', 'mall_activation']);
export const workforcePermission = pgEnum('workforce_permission', ['view', 'schedule', 'review_time', 'review_performance']);
export const workforceAssignmentStatus = pgEnum('workforce_assignment_status', ['offered', 'accepted', 'declined', 'cancelled']);
export const workforceSites = pgTable('workforce_sites', {
  id: serial('id').primaryKey(), name: text('name').notNull(), timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
});
export const workforceTeams = pgTable('workforce_teams', {
  id: serial('id').primaryKey(), name: text('name').notNull(), kind: workforceKind('kind').notNull(),
  siteId: integer('site_id').notNull().references(() => workforceSites.id),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
});
export const workforceMembers = pgTable('workforce_members', {
  id: serial('id').primaryKey(), teamId: integer('team_id').notNull().references(() => workforceTeams.id),
  employeeId: integer('employee_id').notNull().references((): AnyPgColumn => employees.id),
  startAt: timestamp('start_at', {withTimezone: true}).notNull(), endAt: timestamp('end_at', {withTimezone: true}).notNull(),
}, t => [check('workforce_member_dates', sql`${t.endAt} > ${t.startAt}`), index('workforce_member_team_employee').on(t.teamId, t.employeeId)]);
export const workforceGrants = pgTable('workforce_grants', {
  id: serial('id').primaryKey(), teamId: integer('team_id').notNull().references(() => workforceTeams.id),
  userId: integer('user_id').notNull().references((): AnyPgColumn => users.id), permission: workforcePermission('permission').notNull(),
  startAt: timestamp('start_at', {withTimezone: true}).notNull(), endAt: timestamp('end_at', {withTimezone: true}).notNull(),
  revokedAt: timestamp('revoked_at', {withTimezone: true}),
}, t => [check('workforce_grant_dates', sql`${t.endAt} > ${t.startAt}`), index('workforce_grant_user_team').on(t.userId, t.teamId)]);
export const workforceShifts = pgTable('workforce_shifts', {
  id: serial('id').primaryKey(), teamId: integer('team_id').notNull().references(() => workforceTeams.id),
  role: text('role').notNull(), station: text('station'), headcount: integer('headcount').notNull(),
  startAt: timestamp('start_at', {withTimezone: true}).notNull(), endAt: timestamp('end_at', {withTimezone: true}).notNull(),
  breakMinutes: integer('break_minutes').notNull().default(0),
  createdBy: integer('created_by').notNull().references((): AnyPgColumn => users.id),
}, t => [check('workforce_shift_dates', sql`${t.endAt} > ${t.startAt} AND ${t.endAt} <= ${t.startAt} + interval '24 hours'`),
  check('workforce_shift_capacity', sql`${t.headcount} BETWEEN 1 AND 500`),
  check('workforce_shift_break', sql`${t.breakMinutes} >= 0 AND ${t.breakMinutes} < extract(epoch FROM (${t.endAt} - ${t.startAt})) / 60`),
  index('workforce_shift_team_time').on(t.teamId, t.startAt)]);
export const workforceAssignments = pgTable('workforce_assignments', {
  id: serial('id').primaryKey(), shiftId: integer('shift_id').notNull().references(() => workforceShifts.id),
  employeeId: integer('employee_id').notNull().references((): AnyPgColumn => employees.id),
  status: workforceAssignmentStatus('status').notNull().default('offered'),
  createdBy: integer('created_by').notNull().references((): AnyPgColumn => users.id),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  respondedAt: timestamp('responded_at', {withTimezone: true}), cancellationReason: text('cancellation_reason'),
}, t => [uniqueIndex('workforce_assignment_shift_employee').on(t.shiftId, t.employeeId), index('workforce_assignment_employee').on(t.employeeId)]);

export const timesheetStatus = pgEnum('timesheet_status', ['draft', 'submitted', 'returned', 'approved', 'payroll_locked']);
export const workforceTimesheets = pgTable('workforce_timesheets', {
  id: serial('id').primaryKey(), assignmentId: integer('assignment_id').notNull().unique().references(() => workforceAssignments.id),
  status: timesheetStatus('status').notNull().default('draft'), version: integer('version').notNull().default(1),
  actualStartAt: timestamp('actual_start_at', {withTimezone:true}).notNull(), actualEndAt: timestamp('actual_end_at', {withTimezone:true}).notNull(),
  breakMinutes: integer('break_minutes').notNull(), workedMinutes: integer('worked_minutes').notNull(), employeeNote: text('employee_note').notNull(),
  submittedAt: timestamp('submitted_at', {withTimezone:true}), reviewerId: integer('reviewer_id').references(():AnyPgColumn => users.id),
  reviewedAt: timestamp('reviewed_at', {withTimezone:true}), reviewNote: text('review_note'), payableMinutes: integer('payable_minutes'), policyReference: text('policy_reference'),
  payrollId: integer('payroll_id').references(():AnyPgColumn => payroll.id), lockedBy: integer('locked_by').references(():AnyPgColumn => users.id), lockedAt: timestamp('locked_at', {withTimezone:true}),
  createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(), updatedAt: timestamp('updated_at', {withTimezone:true}).defaultNow().notNull(),
}, t => [check('timesheet_actual_dates',sql`${t.actualEndAt}>${t.actualStartAt} AND ${t.actualEndAt}<=${t.actualStartAt}+interval '24 hours'`),
  check('timesheet_minutes',sql`${t.version}>0 AND ${t.breakMinutes}>=0 AND ${t.workedMinutes}>0 AND ${t.workedMinutes}+${t.breakMinutes}=extract(epoch FROM (${t.actualEndAt}-${t.actualStartAt}))/60`),
  check('timesheet_payable_minutes',sql`${t.payableMinutes} IS NULL OR (${t.payableMinutes}>=0 AND ${t.payableMinutes}<=${t.workedMinutes}+${t.breakMinutes})`),
  check('timesheet_approval_fields',sql`${t.status} NOT IN ('approved','payroll_locked') OR (${t.reviewerId} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL AND ${t.payableMinutes} IS NOT NULL AND ${t.policyReference} IS NOT NULL)`),
  check('timesheet_lock_fields',sql`(${t.status}='payroll_locked') = (${t.payrollId} IS NOT NULL AND ${t.lockedBy} IS NOT NULL AND ${t.lockedAt} IS NOT NULL)`),
  index('timesheet_status_updated').on(t.status,t.updatedAt)]);
export const timesheetRevisions = pgTable('timesheet_revisions', {
  id: serial('id').primaryKey(), timesheetId: integer('timesheet_id').notNull().references(() => workforceTimesheets.id), version: integer('version').notNull(),
  actorId: integer('actor_id').notNull().references(():AnyPgColumn => users.id), action: text('action').notNull(), reason: text('reason').notNull(),
  snapshot: jsonb('snapshot').notNull(), createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(),
}, t => [uniqueIndex('timesheet_revision_version').on(t.timesheetId,t.version)]);

export const assignmentReviewStatus = pgEnum('assignment_review_status', ['published', 'disputed', 'resolved', 'withdrawn']);
export const assignmentReviews = pgTable('assignment_reviews', {
  id: serial('id').primaryKey(), assignmentId: integer('assignment_id').notNull().unique().references(() => workforceAssignments.id),
  authorId: integer('author_id').notNull().references(():AnyPgColumn => users.id),
  status: assignmentReviewStatus('status').notNull().default('published'), version: integer('version').notNull().default(1),
  rubricVersion: integer('rubric_version').notNull(), rubric: jsonb('rubric').notNull(),
  punctuality: integer('punctuality'), service: integer('service'), teamwork: integer('teamwork'), roleSkill: integer('role_skill'),
  evidence: jsonb('evidence').$type<Record<'punctuality'|'service'|'teamwork'|'roleSkill',string>>().notNull(),
  roleExpectation: text('role_expectation').notNull(), summary: text('summary').notNull(), improvementActions: text('improvement_actions').notNull(),
  responseKind: text('response_kind'), employeeResponse: text('employee_response'), respondedAt: timestamp('responded_at', {withTimezone:true}),
  resolution: text('resolution'), resolutionReason: text('resolution_reason'), resolvedBy: integer('resolved_by').references(():AnyPgColumn => users.id), resolvedAt: timestamp('resolved_at', {withTimezone:true}),
  createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(), updatedAt: timestamp('updated_at', {withTimezone:true}).defaultNow().notNull(),
}, t => [check('assignment_review_scores',sql`(${t.punctuality} IS NULL OR ${t.punctuality} BETWEEN 1 AND 5) AND (${t.service} IS NULL OR ${t.service} BETWEEN 1 AND 5) AND (${t.teamwork} IS NULL OR ${t.teamwork} BETWEEN 1 AND 5) AND (${t.roleSkill} IS NULL OR ${t.roleSkill} BETWEEN 1 AND 5) AND coalesce(${t.punctuality},${t.service},${t.teamwork},${t.roleSkill}) IS NOT NULL`),
  check('assignment_review_versions',sql`${t.version}>0 AND ${t.rubricVersion}>0`),
  check('assignment_review_dispute',sql`${t.status}<>'disputed' OR (${t.responseKind}='dispute' AND ${t.employeeResponse} IS NOT NULL)`),
  index('assignment_review_status_updated').on(t.status,t.updatedAt)]);
export const assignmentReviewHistory = pgTable('assignment_review_history', {
  id: serial('id').primaryKey(), reviewId: integer('review_id').notNull().references(() => assignmentReviews.id), version: integer('version').notNull(),
  actorId: integer('actor_id').notNull().references(():AnyPgColumn => users.id), action: text('action').notNull(), reason: text('reason').notNull(), snapshot: jsonb('snapshot').notNull(),
  createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(),
}, t => [uniqueIndex('assignment_review_history_version').on(t.reviewId,t.version)]);

// HR helpdesk content is stored separately from organization-wide activity logs.
export const helpdeskStatus = pgEnum('helpdesk_status', ['open', 'in_progress', 'waiting_employee', 'resolved', 'closed']);
export const helpdeskCases = pgTable('helpdesk_cases', {
  id: serial('id').primaryKey(), title: text('title').notNull(), category: text('category').notNull(),
  confidential: boolean('confidential').notNull().default(false), status: helpdeskStatus('status').notNull().default('open'),
  requesterId: integer('requester_id').notNull().references((): AnyPgColumn => users.id),
  assigneeId: integer('assignee_id').references((): AnyPgColumn => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone:true}).defaultNow().notNull(),
}, t => [index('helpdesk_requester_updated').on(t.requesterId,t.updatedAt),index('helpdesk_assignee_status').on(t.assigneeId,t.status),
  check('helpdesk_version_positive',sql`${t.version}>0`)]);
export const helpdeskMessages = pgTable('helpdesk_messages', {
  id: serial('id').primaryKey(), caseId: integer('case_id').notNull().references(() => helpdeskCases.id),
  authorId: integer('author_id').notNull().references((): AnyPgColumn => users.id),
  body: text('body').notNull(), internal: boolean('internal').notNull().default(false),
  createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(),
}, t => [index('helpdesk_message_case').on(t.caseId,t.id)]);
export const helpdeskAttachments = pgTable('helpdesk_attachments', {
  id: serial('id').primaryKey(), messageId: integer('message_id').notNull().references(() => helpdeskMessages.id),
  filename: text('filename').notNull(), objectKey: text('object_key').notNull().unique(), size: integer('size').notNull(),
});
export const helpdeskEvents = pgTable('helpdesk_events', {
  id: serial('id').primaryKey(), caseId: integer('case_id').notNull().references(() => helpdeskCases.id),
  actorId: integer('actor_id').notNull().references((): AnyPgColumn => users.id), details: text('details').notNull(),
  internal: boolean('internal').notNull().default(false),
  createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(),
}, t => [index('helpdesk_event_case').on(t.caseId,t.id)]);

// Enums
export const employeeTypeEnum = pgEnum('employee_type', ['permanent', 'temporary', 'contract']);
export const documentStatusEnum = pgEnum('document_status', ['valid', 'expiring_soon', 'expired']);
export const leaveStatusEnum = pgEnum('leave_status', ['pending', 'approved', 'rejected', 'cancelled']);
export const attendanceStatusEnum = pgEnum('attendance_status', ['present', 'absent', 'late', 'on_leave']);
export const genderEnum = pgEnum('gender', ['male', 'female', 'other']);
export const maritalStatusEnum = pgEnum('marital_status', ['single', 'married', 'divorced', 'widowed']);
export const religionEnum = pgEnum('religion', ['islam', 'christianity', 'hinduism', 'buddhism', 'other']);
export const bloodGroupEnum = pgEnum('blood_group', ['a_positive', 'a_negative', 'b_positive', 'b_negative', 'ab_positive', 'ab_negative', 'o_positive', 'o_negative']);
export const employeeCategoryEnum = pgEnum('employee_category', ['expatriate', 'national']);
export const visaTypeEnum = pgEnum('visa_type', ['work_visa', 'family_visa', 'business_visa', 'tourist_visa', 'other']);

// Communication Hub Enums
export const notificationChannelEnum = pgEnum('notification_channel', ['sms', 'email', 'push', 'slack']);
export const notificationStatusEnum = pgEnum('notification_status', ['sent', 'delivered', 'failed', 'pending']);
export const announcementTargetEnum = pgEnum('announcement_target', ['all', 'department', 'role', 'custom']);

// Leave & Absence Enums
export const leaveCategoryEnum = pgEnum('leave_category', ['paid', 'unpaid']);
export const accrualMethodEnum = pgEnum('accrual_method', ['fixed_amount', 'accrual_rate', 'none']);
export const halfDayOptionEnum = pgEnum('half_day_option', ['no_half_day', 'first_half', 'second_half']);

// Event Staff Management Enums
export const eventTypeEnum = pgEnum('event_type', ['conference', 'concert', 'sports_event', 'exhibition', 'corporate', 'social', 'other']);
export const eventStatusEnum = pgEnum('event_status', ['draft', 'upcoming', 'ongoing', 'completed', 'cancelled']);
export const assignmentStatusEnum = pgEnum('assignment_status', ['assigned', 'confirmed', 'declined', 'checked_in', 'checked_out', 'no_show', 'completed']);
export const rosterStatusEnum = pgEnum('roster_status', ['draft', 'published', 'closed']);
export const performanceRatingEnum = pgEnum('performance_rating', ['outstanding', 'good', 'satisfactory', 'needs_improvement', 'poor']);

// Recruitment & Onboarding Enums
export const requisitionStatusEnum = pgEnum('requisition_status', ['draft', 'pending_approval', 'approved', 'open', 'on_hold', 'closed', 'cancelled']);
export const applicationStatusEnum = pgEnum('application_status', ['new', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected']);
export const interviewRoundEnum = pgEnum('interview_round', ['first', 'second', 'final', 'technical', 'hr']);
export const interviewRecommendationEnum = pgEnum('interview_recommendation', ['hire', 'reject', 'hold']);
export const applicationSourceEnum = pgEnum('application_source', ['job_board', 'company_website', 'referral', 'internal', 'linkedin', 'social_media', 'other']);
export const taskStatusEnum = pgEnum('task_status', ['not_started', 'in_progress', 'completed', 'overdue']);

// Performance Management Enums
export const reviewTypeEnum = pgEnum('review_type', ['annual', 'quarterly', 'probation', 'promotion', 'special']);
export const reviewStatusEnum = pgEnum('review_status', ['draft', 'self_review', 'manager_review', 'hr_review', 'completed', 'cancelled']);
export const reviewRatingEnum = pgEnum('review_rating', ['exceptional', 'exceeds', 'meets', 'needs_improvement', 'unsatisfactory']);
export const goalStatusEnum = pgEnum('goal_status', ['not_started', 'in_progress', 'completed', 'cancelled', 'extended']);
export const goalPriorityEnum = pgEnum('goal_priority', ['low', 'medium', 'high', 'critical']);
export const feedbackTypeEnum = pgEnum('feedback_type', ['praise', 'constructive', 'peer', 'client', 'suggestion']);

// Security & Role Management Enums
export const securityEventTypeEnum = pgEnum('security_event_type', ['login_success', 'login_failure', 'logout', 'password_change', 'permission_change', 'role_assignment', 'data_access', 'api_access', 'error']);
export const userRoleEnum = pgEnum('user_role', [
  'super_admin',        // Unrestricted access to all modules and data
  'c_level_executive',  // High-level read-only access to dashboards
  'hr_director',        // Full access to all HR modules organization-wide
  'hr_manager',         // Full HR access scoped to departments/units
  'recruiter',          // Deep access to recruitment, limited elsewhere
  'payroll_specialist', // Deep access to payroll and financial data
  'department_head',    // Manager access limited to their team
  'event_manager',      // Access limited to event staff and event management
  'finance_audit',      // Read-only access to payroll and compliance reports
  'permanent_employee', // Self-service access to own data
  'temporary_staff',    // Limited self-service for event staff
  'employee',           // Legacy role for backwards compatibility
  'admin',              // Legacy role for backwards compatibility
  'hr',                 // Legacy role for backwards compatibility
  'finance',            // Legacy role for backwards compatibility
  'manager'             // Legacy role for backwards compatibility
]);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected']);

// Export UserRole type for use in permissions
export type UserRole = typeof userRoleEnum.enumValues[number];

// Bulk Import Jobs table (for tracking bulk operations)
export const bulkImportJobs = pgTable("bulk_import_jobs", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  status: text("status").notNull().default("processing"), // processing, completed, failed
  totalRows: integer("total_rows").default(0),
  successfulRows: integer("successful_rows").default(0),
  failedRows: integer("failed_rows").default(0),
  errorLog: jsonb("error_log"), // Store validation errors
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// Users table (for system access)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: userRoleEnum("role").notNull().default("employee"),
  department: text("department"),
  qidNumber: text("qid_number").unique(),
  isActive: boolean("is_active").default(false).notNull(),
  isEmailVerified: boolean("is_email_verified").default(false).notNull(),
  approvalStatus: approvalStatusEnum("approval_status").default("pending").notNull(),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  lastLogin: timestamp("last_login"),
  refreshToken: text("refresh_token"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockoutUntil: timestamp("lockout_until"),
  avatar: text("avatar"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employees table
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).unique(),
  employeeId: text("employee_id").notNull().unique(), // Custom employee ID
  
  // Personal Information
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullNameArabic: text("full_name_arabic"),
  gender: genderEnum("gender").notNull(),
  dateOfBirth: date("date_of_birth").notNull(),
  nationality: text("nationality").notNull(),
  qidNumber: text("qid_number").notNull().unique(),
  maritalStatus: maritalStatusEnum("marital_status"),
  religion: religionEnum("religion"),
  bloodGroup: bloodGroupEnum("blood_group"),
  primaryMobile: text("primary_mobile").notNull(),
  secondaryContact: text("secondary_contact"),
  personalEmail: text("personal_email"),
  photo: text("photo"),
  residentialAddress: text("residential_address").notNull(),
  homeCountryAddress: text("home_country_address"),
  
  // Emergency Contact
  emergencyContactName: text("emergency_contact_name").notNull(),
  emergencyContactNumber: text("emergency_contact_number").notNull(),
  emergencyContactRelation: text("emergency_contact_relation"),
  
  // Employment Details
  type: employeeTypeEnum("type").notNull(), // permanent, temporary, contract
  eventStaffEligible: boolean("event_staff_eligible").default(false),
  department: text("department").notNull(),
  position: text("position").notNull(),
  location: text("location").notNull(),
  reportingManagerId: integer("reporting_manager_id").references((): AnyPgColumn => employees.id),
  secondaryManagerId: integer("secondary_manager_id").references((): AnyPgColumn => employees.id),
  joiningDate: date("joining_date").notNull(),
  contractEndDate: date("contract_end_date"),
  terminationDate: date("termination_date"),
  roleId: integer("role_id").references((): AnyPgColumn => roles.id),
  workLocation: text("work_location"),
  workEmail: text("work_email"),
  workPhone: text("work_phone"),
  costCenter: text("cost_center"),
  employeeCategory: employeeCategoryEnum("employee_category"),
  jobGrade: text("job_grade"),
  probationPeriod: integer("probation_period"),
  noticePeriod: integer("notice_period"),
  
  // Bank Details
  bankName: text("bank_name"),
  ibanNumber: text("iban_number"),
  swiftCode: text("swift_code"),
  bankBranch: text("bank_branch"),
  accountName: text("account_name"),
  
  // Status
  status: text("status").notNull().default("active"), // active, inactive, on_leave
  
  // System fields
  recordVersion: integer("record_version").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Documents table (for compliance)
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  documentType: text("document_type").notNull(), // passport, visa, work_permit, health_card, medical_certificate, education, professional_certification
  documentNumber: text("document_number").notNull(),
  issueDate: date("issue_date").notNull(),
  expiryDate: date("expiry_date").notNull(),
  status: documentStatusEnum("status").notNull(),
  documentFile: text("document_file"), // file path/url
  issueAuthority: text("issue_authority"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Documents (specific document details)
export const employeeDocuments = pgTable("employee_documents", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  
  // Passport
  passportNumber: text("passport_number"),
  passportExpiryDate: date("passport_expiry_date"),
  passportScan: text("passport_scan"),
  
  // Visa
  visaType: visaTypeEnum("visa_type"),
  visaNumber: text("visa_number"),
  visaExpiryDate: date("visa_expiry_date"),
  visaScan: text("visa_scan"),
  
  // Work Permit
  workPermitNumber: text("work_permit_number"),
  workPermitExpiryDate: date("work_permit_expiry_date"),
  workPermitScan: text("work_permit_scan"),
  
  // Health Card
  healthCardNumber: text("health_card_number"),
  healthCardExpiryDate: date("health_card_expiry_date"),
  healthCardScan: text("health_card_scan"),
  
  // Medical Certificate
  medicalCertificateDate: date("medical_certificate_date"),
  medicalCertificateScan: text("medical_certificate_scan"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Education & Qualifications
export const employeeEducation = pgTable("employee_education", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  degree: text("degree").notNull(),
  institution: text("institution").notNull(),
  year: integer("year").notNull(),
  grade: text("grade"),
  certificateFile: text("certificate_file"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Professional Certifications
export const employeeCertifications = pgTable("employee_certifications", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  certificateName: text("certificate_name").notNull(),
  issuingAuthority: text("issuing_authority").notNull(),
  issueDate: date("issue_date").notNull(),
  expiryDate: date("expiry_date"),
  certificateFile: text("certificate_file"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Skills - legacy table (will be replaced with new schema)
export const employeeSkillsLegacy = pgTable("employee_skills_legacy", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  skillName: text("skill_name").notNull(),
  proficiencyLevel: text("proficiency_level").notNull(), // beginner, intermediate, advanced, expert
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Languages
export const employeeLanguages = pgTable("employee_languages", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  language: text("language").notNull(),
  proficiencyLevel: text("proficiency_level").notNull(), // beginner, intermediate, advanced
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Enum for attendance clock methods
export const clockMethodEnum = pgEnum('clock_method', ['qr_code', 'biometric', 'mobile_app', 'manual']);

// Attendance table
export const attendance = pgTable("attendance", {
  totalBreakMinutes: integer("total_break_minutes").notNull().default(0),
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  date: date("date").notNull(),
  checkIn: timestamp("check_in"),
  checkOut: timestamp("check_out"),
  checkInMethod: clockMethodEnum("check_in_method"),
  checkOutMethod: clockMethodEnum("check_out_method"),
  status: attendanceStatusEnum("status").notNull(),
  location: text("location"),
  geofenceId: text("geofence_id"),
  breakStartTime: timestamp("break_start_time"),
  breakEndTime: timestamp("break_end_time"),
  totalWorkHours: integer("total_work_hours"), // Stored in minutes
  overtimeHours: integer("overtime_hours"), // Stored in minutes
  notes: text("notes"),
  approvedBy: integer("approved_by").references(() => employees.id),
  approvalDate: timestamp("approval_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leave table
export const leaves = pgTable("leaves", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  leaveType: text("leave_type").notNull(), // annual, sick, emergency, etc.
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  totalDays: integer("total_days").notNull(),
  reason: text("reason").notNull(),
  status: leaveStatusEnum("status").notNull().default("pending"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leave Type Configuration table
export const leaveTypes = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: leaveCategoryEnum("category").notNull(), // paid, unpaid
  accrualMethod: accrualMethodEnum("accrual_method").notNull(), // fixed_amount, accrual_rate, none
  accrualRate: decimal("accrual_rate"), // days per month
  maxAccrual: decimal("max_accrual"), // maximum days that can be accrued
  carryoverAllowed: boolean("carryover_allowed").default(false),
  carryoverLimit: decimal("carryover_limit"), // maximum days that can be carried over
  requiresMedicalCertificate: boolean("requires_medical_certificate").default(false),
  minServiceDays: integer("min_service_days").default(0), // minimum service days required to be eligible
  maxConsecutiveDays: integer("max_consecutive_days"), // maximum consecutive days allowed
  applicableGenders: text("applicable_genders").array(), // male, female, other
  description: text("description"),
  active: boolean("active").default(true),
  qatarLaborLawMandated: boolean("qatar_labor_law_mandated").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Leave Balance table
export const leaveBalances = pgTable("leave_balances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  leaveTypeId: integer("leave_type_id").references(() => leaveTypes.id).notNull(),
  year: integer("year").notNull(),
  openingBalance: decimal("opening_balance").notNull().default("0"),
  accrued: decimal("accrued").notNull().default("0"),
  used: decimal("used").notNull().default("0"),
  pending: decimal("pending").notNull().default("0"), // pending leaves
  adjusted: decimal("adjusted").notNull().default("0"), // manual adjustments
  lastAccrualDate: date("last_accrual_date"),
  expiryDate: date("expiry_date"), // when the balance expires
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leave Supporting Documents
export const leaveSupportingDocuments = pgTable("leave_supporting_documents", {
  id: serial("id").primaryKey(),
  leaveId: integer("leave_id").references(() => leaves.id).notNull(),
  documentType: text("document_type").notNull(), // medical_certificate, travel_document, etc.
  documentFile: text("document_file").notNull(), // file path/url
  uploadedBy: integer("uploaded_by").references(() => users.id).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leave Approval Workflow
export const leaveApprovals = pgTable("leave_approvals", {
  id: serial("id").primaryKey(),
  leaveId: integer("leave_id").references(() => leaves.id).notNull(),
  approverId: integer("approver_id").references(() => employees.id).notNull(),
  approvalOrder: integer("approval_order").notNull(), // 1 for first level, 2 for second level
  status: leaveStatusEnum("status").notNull().default("pending"),
  comments: text("comments"),
  actionDate: timestamp("action_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Payroll table
export const payroll = pgTable("payroll", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  basicSalary: decimal("basic_salary", {precision:14,scale:2}).notNull(),
  allowances: json("allowances").notNull(), // housing, transport, etc.
  deductions: json("deductions").notNull(), // loans, advances, etc.
  netSalary: decimal("net_salary", {precision:14,scale:2}).notNull(),
  wpsReference: text("wps_reference"), // WPS compliance reference
  status: text("status").notNull(), // processed, pending, failed
  processedBy: integer("processed_by").references(() => users.id),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Staff Management Tables

// Events (for temporary staff management)
export const events = pgTable("events", {
  eventType: eventTypeEnum("event_type").notNull().default("other"),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  location: text("location").notNull(),
  status: text("status").notNull().default("draft"), // Changed from enum to text to match database
  createdBy: integer("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Staff Roles (requirements for each event)
export const eventRoles = pgTable("event_roles", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id).notNull(),
  roleName: text("role_name").notNull(),
  roleDescription: text("role_description"),
  numberOfStaff: integer("number_of_staff").notNull().default(1),
  hourlyRate: decimal("hourly_rate").notNull(),
  requiredSkills: text("required_skills").array(),
  qualifications: text("qualifications").array(),
  uniformRequirements: text("uniform_requirements"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Staff Profile (extension of employee for event staffing)
export const eventStaffProfiles = pgTable("event_staff_profiles", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  preferredRoles: text("preferred_roles").array(),
  availability: json("availability").notNull(), // JSON calendar data for availability
  averageRating: decimal("average_rating"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Rosters
export const eventRosters = pgTable("event_rosters", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id).notNull(),
  rosterName: text("roster_name").notNull(),
  status: rosterStatusEnum("status").notNull().default("draft"),
  publishedAt: timestamp("published_at"),
  publishedBy: integer("published_by").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Staff Assignments
export const eventStaffAssignments = pgTable("event_staff_assignments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id).notNull(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  role: text("role").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Staff Performance Evaluation
export const eventStaffPerformance = pgTable("event_staff_performance", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").references(() => eventStaffAssignments.id).notNull(),
  ratedBy: integer("rated_by").references(() => employees.id).notNull(),
  rating: performanceRatingEnum("rating").notNull(),
  punctualityRating: integer("punctuality_rating").notNull(), // 1-5
  attitudeRating: integer("attitude_rating").notNull(), // 1-5
  skillRating: integer("skill_rating").notNull(), // 1-5
  comments: text("comments"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Communication
export const eventCommunications = pgTable("event_communications", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id).notNull(),
  senderId: integer("sender_id").references(() => users.id).notNull(),
  messageType: text("message_type").notNull(), // announcement, notification, message
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Event Communication Recipients
export const eventCommunicationRecipients = pgTable("event_communication_recipients", {
  id: serial("id").primaryKey(),
  communicationId: integer("communication_id").references(() => eventCommunications.id).notNull(),
  recipientId: integer("recipient_id").references(() => employees.id).notNull(),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Communication Hub
// Notifications Table
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  message: text("message").notNull(),
  channel: notificationChannelEnum("channel").notNull(),
  status: notificationStatusEnum("status").notNull().default("pending"),
  data: jsonb("data"), // For additional data like custom payload
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at"),
  externalId: text("external_id"), // For Twilio message SID, SendGrid ID, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Announcements Table
export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: integer("author_id").references(() => users.id).notNull(),
  targetAudience: announcementTargetEnum("target_audience").notNull(),
  targetDepartment: text("target_department"), // Only used if targetAudience is 'department'
  targetRole: text("target_role"), // Only used if targetAudience is 'role'
  expiryDate: date("expiry_date"),
  isActive: boolean("is_active").default(true),
  isPinned: boolean("is_pinned").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Slack Integration Table
export const slackIntegration = pgTable("slack_integration", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  slackUserId: text("slack_user_id").notNull(),
  slackEmail: text("slack_email").notNull(),
  slackUsername: text("slack_username").notNull(),
  isActive: boolean("is_active").default(true),
  lastSynced: timestamp("last_synced"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Notification Preferences
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  emailEnabled: boolean("email_enabled").default(true),
  smsEnabled: boolean("sms_enabled").default(true),
  pushEnabled: boolean("push_enabled").default(true),
  slackEnabled: boolean("slack_enabled").default(true),
  announcements: boolean("announcements").default(true),
  leaveUpdates: boolean("leave_updates").default(true),
  documentExpiry: boolean("document_expiry").default(true),
  eventAssignments: boolean("event_assignments").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Activity Logs
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  details: text("details"),
  entityType: text("entity_type"), // employee, document, attendance, etc.
  entityId: integer("entity_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Role & Permission Management

// Roles Table
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Permissions Table
export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  module: text("module").notNull(), // e.g., employees, attendance, documents, etc.
  action: text("action").notNull(), // e.g., create, read, update, delete
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Role Permissions (Junction Table)
export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").references(() => roles.id).notNull(),
  permissionId: integer("permission_id").references(() => permissions.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User Roles (Junction Table)
export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  roleId: integer("role_id").references(() => roles.id).notNull(),
  assignedBy: integer("assigned_by").references(() => users.id),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
});

// Security Logs
export const securityLogs = pgTable("security_logs", {
  id: serial("id").primaryKey(),
  eventType: securityEventTypeEnum("event_type").notNull(),
  userId: integer("user_id").references(() => users.id),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  description: text("description").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  resourceType: text("resource_type"), // API endpoint, page, etc.
  resourceId: text("resource_id"), // Specific identifier for the resource
  metadata: jsonb("metadata"), // Additional details about the event
  severity: text("severity").default("info"), // info, warning, error, critical
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Auth Session Management
export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastUsed: timestamp("last_used").defaultNow().notNull(),
  metadata: jsonb("metadata"), // Device info, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Shift Schedules
export const shiftSchedules = pgTable("shift_schedules", {
  notes: text("notes"),
  id: serial("id").primaryKey(),
  shiftName: text("shift_name").notNull(),
  date: date("date").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  breakDuration: integer("break_duration").notNull(), // in minutes
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  location: text("location").notNull(),
  assignedRole: text("assigned_role"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Geofences
export const geofences = pgTable("geofences", {
  id: serial("id").primaryKey(),
  geofenceId: text("geofence_id").notNull().unique(),
  geofenceName: text("geofence_name").notNull(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  radius: integer("radius").notNull(), // in meters
  startDate: date("start_date"),
  endDate: date("end_date"),
  associatedLocations: text("associated_locations").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// RECRUITMENT TABLES

// Job Requisitions
export const jobRequisitions = pgTable("job_requisitions", {
  id: serial("id").primaryKey(),
  requisitionId: text("requisition_id").notNull().unique(), // Custom ID: JR-2023-001
  jobTitle: text("job_title").notNull(),
  department: text("department").notNull(),
  location: text("location").notNull(),
  positionType: text("position_type").notNull(), // permanent, temporary, contract
  salaryRange: text("salary_range"),
  numberOfVacancies: integer("number_of_vacancies").notNull(),
  jobDescription: text("job_description").notNull(),
  qualifications: text("qualifications").notNull(),
  responsibilities: text("responsibilities").notNull(),
  requiredSkills: text("required_skills").notNull(),
  preferredSkills: text("preferred_skills"),
  postingStartDate: date("posting_start_date"),
  postingEndDate: date("posting_end_date"),
  isInternal: boolean("is_internal").default(false),
  status: requisitionStatusEnum("status").notNull().default("draft"),
  requestedBy: integer("requested_by").references(() => employees.id).notNull(),
  approvedBy: integer("approved_by").references(() => employees.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Job Postings (channels where job is posted)
export const jobPostings = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").references(() => jobRequisitions.id).notNull(),
  channel: text("channel").notNull(), // internal_portal, company_website, linkedin, indeed, etc.
  channelUrl: text("channel_url"),
  postDate: date("post_date").notNull(),
  expiryDate: date("expiry_date"),
  status: text("status").notNull(), // active, expired, closed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Candidates
export const candidates = pgTable("candidates", {
  id: serial("id").primaryKey(),
  fullNameEn: text("full_name_en").notNull(),
  fullNameAr: text("full_name_ar"),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  linkedinProfile: text("linkedin_profile"),
  resumeUrl: text("resume_url"),
  coverLetterUrl: text("cover_letter_url"),
  qidNumber: text("qid_number"),
  visaStatus: text("visa_status"),
  source: applicationSourceEnum("source").notNull(),
  referralEmployeeId: integer("referral_employee_id").references(() => employees.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Candidate Skills (many-to-many)
export const candidateSkills = pgTable("candidate_skills", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").references(() => candidates.id).notNull(),
  skillName: text("skill_name").notNull(),
  proficiencyLevel: text("proficiency_level"), // beginner, intermediate, advanced, expert
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Candidate Experience
export const candidateExperience = pgTable("candidate_experience", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").references(() => candidates.id).notNull(),
  jobTitle: text("job_title").notNull(),
  company: text("company").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  isCurrentJob: boolean("is_current_job").default(false),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Candidate Education
export const candidateEducation = pgTable("candidate_education", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").references(() => candidates.id).notNull(),
  degree: text("degree").notNull(),
  institution: text("institution").notNull(),
  fieldOfStudy: text("field_of_study").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  isCurrentStudy: boolean("is_current_study").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Job Applications
export const jobApplications = pgTable("job_applications", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").references(() => candidates.id).notNull(),
  requisitionId: integer("requisition_id").references(() => jobRequisitions.id).notNull(),
  applicationDate: date("application_date").notNull(),
  status: applicationStatusEnum("status").notNull().default("new"),
  screeningScore: integer("screening_score"),
  screeningNotes: text("screening_notes"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Interviews
export const interviews = pgTable("interviews", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").references(() => jobApplications.id).notNull(),
  interviewerId: integer("interviewer_id").references(() => employees.id).notNull(),
  interviewDate: timestamp("interview_date").notNull(),
  interviewType: text("interview_type").notNull(), // phone, video, in-person
  interviewRound: interviewRoundEnum("interview_round").notNull(),
  rating: integer("rating"), // 1-5
  feedback: text("feedback"),
  recommendation: interviewRecommendationEnum("recommendation"),
  status: text("status").notNull(), // scheduled, completed, cancelled, no-show
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Job Offers
export const jobOffers = pgTable("job_offers", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").references(() => jobApplications.id).notNull(),
  offerDate: date("offer_date").notNull(),
  startDate: date("start_date"),
  salary: integer("salary").notNull(),
  benefits: json("benefits"),
  expiryDate: date("expiry_date").notNull(),
  status: text("status").notNull(), // pending, accepted, declined, expired
  acceptanceDate: date("acceptance_date"),
  declineReason: text("decline_reason"),
  offerLetter: text("offer_letter"), // file path
  createdBy: integer("created_by").references(() => employees.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ONBOARDING TABLES

// Onboarding Checklists (templates)
export const onboardingChecklists = pgTable("onboarding_checklists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  departmentSpecific: text("department_specific"),
  employeeTypeSpecific: employeeTypeEnum("employee_type_specific"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Checklist Tasks (template tasks)
export const checklistTasks = pgTable("checklist_tasks", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").references(() => onboardingChecklists.id).notNull(),
  taskName: text("task_name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // pre-joining, first day, first week, first month
  assignedTo: text("assigned_to").notNull(), // hr, manager, it, new_hire
  daysFromStart: integer("days_from_start").notNull(), // days from joining date
  isRequired: boolean("is_required").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Onboarding
export const employeeOnboarding = pgTable("employee_onboarding", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  offerId: integer("offer_id").references(() => jobOffers.id),
  checklistId: integer("checklist_id").references(() => onboardingChecklists.id).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  status: text("status").notNull(), // in_progress, completed, cancelled
  progress: integer("progress").default(0), // percentage
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Onboarding Tasks (assigned to specific employee)
export const onboardingTasks = pgTable("onboarding_tasks", {
  id: serial("id").primaryKey(),
  onboardingId: integer("onboarding_id").references(() => employeeOnboarding.id).notNull(),
  taskId: integer("task_id").references(() => checklistTasks.id).notNull(),
  assignedTo: text("assigned_to").notNull(), // hr, manager, it, new_hire
  assigneeId: integer("assignee_id").references(() => employees.id), // specific person
  dueDate: date("due_date").notNull(),
  completedDate: date("completed_date"),
  status: taskStatusEnum("status").notNull().default("not_started"),
  comments: text("comments"),
  documentUrl: text("document_url"), // if task requires document upload
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
  refreshToken: true,
  passwordResetToken: true,
  passwordResetExpires: true,
  failedLoginAttempts: true,
  lockoutUntil: true,
  approvedAt: true,
}).extend({
  confirmPassword: z.string().min(6, "Confirm password must be at least 6 characters"),
  password: z.string().min(6, "Password must be at least 6 characters")
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, 
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character")
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  recordVersion: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAttendanceSchema = createInsertSchema(attendance).omit({
  id: true,
  createdAt: true,
});

export const insertLeaveSchema = createInsertSchema(leaves).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
});

export const insertLeaveTypeSchema = createInsertSchema(leaveTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLeaveBalanceSchema = createInsertSchema(leaveBalances).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLeaveSupportingDocumentSchema = createInsertSchema(leaveSupportingDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLeaveApprovalSchema = createInsertSchema(leaveApprovals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  actionDate: true,
});

export const insertPayrollSchema = createInsertSchema(payroll).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  processedAt: true,
});

export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEventRoleSchema = createInsertSchema(eventRoles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEventStaffProfileSchema = createInsertSchema(eventStaffProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEventRosterSchema = createInsertSchema(eventRosters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEventStaffAssignmentSchema = createInsertSchema(eventStaffAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
});

export const insertEventStaffPerformanceSchema = createInsertSchema(eventStaffPerformance).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEventCommunicationSchema = createInsertSchema(eventCommunications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEventCommunicationRecipientSchema = createInsertSchema(eventCommunicationRecipients).omit({
  id: true,
  createdAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

// Insert schemas for attendance-related tables
export const insertShiftScheduleSchema = createInsertSchema(shiftSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGeofenceSchema = createInsertSchema(geofences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Insert schemas for additional tables
export const insertEmployeeDocumentSchema = createInsertSchema(employeeDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeEducationSchema = createInsertSchema(employeeEducation).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeCertificationSchema = createInsertSchema(employeeCertifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Legacy employee skills schema (for backward compatibility)
export const insertEmployeeSkillLegacySchema = createInsertSchema(employeeSkillsLegacy).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeLanguageSchema = createInsertSchema(employeeLanguages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Insert schemas for recruitment tables
export const insertJobRequisitionSchema = createInsertSchema(jobRequisitions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  requisitionId: true, // Generated on server
  approvedBy: true, // Set later when approved
  requestedBy: true, // Handled separately on server
});

export const insertJobPostingSchema = createInsertSchema(jobPostings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCandidateSchema = createInsertSchema(candidates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCandidateSkillSchema = createInsertSchema(candidateSkills).omit({
  id: true,
  createdAt: true,
});

export const insertCandidateExperienceSchema = createInsertSchema(candidateExperience).omit({
  id: true,
  createdAt: true,
});

export const insertCandidateEducationSchema = createInsertSchema(candidateEducation).omit({
  id: true,
  createdAt: true,
});

export const insertJobApplicationSchema = createInsertSchema(jobApplications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInterviewSchema = createInsertSchema(interviews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobOfferSchema = createInsertSchema(jobOffers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Insert schemas for onboarding tables
export const insertOnboardingChecklistSchema = createInsertSchema(onboardingChecklists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChecklistTaskSchema = createInsertSchema(checklistTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeOnboardingSchema = createInsertSchema(employeeOnboarding).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOnboardingTaskSchema = createInsertSchema(onboardingTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Communication Hub Insert Schemas
export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  timestamp: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAnnouncementSchema = createInsertSchema(announcements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSlackIntegrationSchema = createInsertSchema(slackIntegration).omit({
  id: true,
  lastSynced: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export type InsertEmployeeDocument = z.infer<typeof insertEmployeeDocumentSchema>;
export type EmployeeDocument = typeof employeeDocuments.$inferSelect;

export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendance.$inferSelect;

export type InsertLeave = z.infer<typeof insertLeaveSchema>;
export type Leave = typeof leaves.$inferSelect;

export type InsertLeaveType = z.infer<typeof insertLeaveTypeSchema>;
export type LeaveType = typeof leaveTypes.$inferSelect;

export type InsertLeaveBalance = z.infer<typeof insertLeaveBalanceSchema>;
export type LeaveBalance = typeof leaveBalances.$inferSelect;

export type InsertLeaveSupportingDocument = z.infer<typeof insertLeaveSupportingDocumentSchema>;
export type LeaveSupportingDocument = typeof leaveSupportingDocuments.$inferSelect;

export type InsertLeaveApproval = z.infer<typeof insertLeaveApprovalSchema>;
export type LeaveApproval = typeof leaveApprovals.$inferSelect;

export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payroll.$inferSelect;

// Event Staff Management Types
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;

export type InsertEventRole = z.infer<typeof insertEventRoleSchema>;
export type EventRole = typeof eventRoles.$inferSelect;

export type InsertEventStaffProfile = z.infer<typeof insertEventStaffProfileSchema>;
export type EventStaffProfile = typeof eventStaffProfiles.$inferSelect;

export type InsertEventRoster = z.infer<typeof insertEventRosterSchema>;
export type EventRoster = typeof eventRosters.$inferSelect;

export type InsertEventStaffAssignment = z.infer<typeof insertEventStaffAssignmentSchema>;
export type EventStaffAssignment = typeof eventStaffAssignments.$inferSelect;

export type InsertEventStaffPerformance = z.infer<typeof insertEventStaffPerformanceSchema>;
export type EventStaffPerformance = typeof eventStaffPerformance.$inferSelect;

export type InsertEventCommunication = z.infer<typeof insertEventCommunicationSchema>;
export type EventCommunication = typeof eventCommunications.$inferSelect;

export type InsertEventCommunicationRecipient = z.infer<typeof insertEventCommunicationRecipientSchema>;
export type EventCommunicationRecipient = typeof eventCommunicationRecipients.$inferSelect;

export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export type InsertShiftSchedule = z.infer<typeof insertShiftScheduleSchema>;
export type ShiftSchedule = typeof shiftSchedules.$inferSelect;

export type InsertGeofence = z.infer<typeof insertGeofenceSchema>;
export type Geofence = typeof geofences.$inferSelect;

export type InsertEmployeeEducation = z.infer<typeof insertEmployeeEducationSchema>;
export type EmployeeEducation = typeof employeeEducation.$inferSelect;

export type InsertEmployeeCertification = z.infer<typeof insertEmployeeCertificationSchema>;
export type EmployeeCertification = typeof employeeCertifications.$inferSelect;

export type InsertEmployeeSkill = z.infer<typeof insertEmployeeSkillSchema>;
export type EmployeeSkill = typeof employeeSkills.$inferSelect;

export type InsertEmployeeLanguage = z.infer<typeof insertEmployeeLanguageSchema>;
export type EmployeeLanguage = typeof employeeLanguages.$inferSelect;

// Recruitment Types
export type InsertJobRequisition = z.infer<typeof insertJobRequisitionSchema>;
export type JobRequisition = typeof jobRequisitions.$inferSelect;

export type InsertJobPosting = z.infer<typeof insertJobPostingSchema>;
export type JobPosting = typeof jobPostings.$inferSelect;

export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidates.$inferSelect;

export type InsertCandidateSkill = z.infer<typeof insertCandidateSkillSchema>;
export type CandidateSkill = typeof candidateSkills.$inferSelect;

export type InsertCandidateExperience = z.infer<typeof insertCandidateExperienceSchema>;
export type CandidateExperience = typeof candidateExperience.$inferSelect;

export type InsertCandidateEducation = z.infer<typeof insertCandidateEducationSchema>;
export type CandidateEducation = typeof candidateEducation.$inferSelect;

export type InsertJobApplication = z.infer<typeof insertJobApplicationSchema>;
export type JobApplication = typeof jobApplications.$inferSelect;

export type InsertInterview = z.infer<typeof insertInterviewSchema>;
export type Interview = typeof interviews.$inferSelect;

export type InsertJobOffer = z.infer<typeof insertJobOfferSchema>;
export type JobOffer = typeof jobOffers.$inferSelect;

// Onboarding Types
export type InsertOnboardingChecklist = z.infer<typeof insertOnboardingChecklistSchema>;
export type OnboardingChecklist = typeof onboardingChecklists.$inferSelect;

export type InsertChecklistTask = z.infer<typeof insertChecklistTaskSchema>;
export type ChecklistTask = typeof checklistTasks.$inferSelect;

export type InsertEmployeeOnboarding = z.infer<typeof insertEmployeeOnboardingSchema>;
export type EmployeeOnboarding = typeof employeeOnboarding.$inferSelect;

// Performance Management Module Tables
// Performance Reviews
export const performanceReviews = pgTable("performance_reviews", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  reviewerId: integer("reviewer_id").references(() => employees.id).notNull(),
  reviewType: reviewTypeEnum("review_type").notNull(),
  reviewPeriodStart: date("review_period_start").notNull(),
  reviewPeriodEnd: date("review_period_end").notNull(),
  dueDate: date("due_date").notNull(),
  completedDate: date("completed_date"),
  status: reviewStatusEnum("status").notNull().default("draft"),
  overallRating: reviewRatingEnum("overall_rating"),
  summary: text("summary"),
  strengths: text("strengths"),
  areasForImprovement: text("areas_for_improvement"),
  hrComments: text("hr_comments"),
  privateNotes: text("private_notes"),
  isTemplate: boolean("is_template").default(false),
  templateName: text("template_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Review Sections (e.g., Leadership, Technical Skills, etc.)
export const reviewSections = pgTable("review_sections", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id").references(() => performanceReviews.id).notNull(),
  sectionName: text("section_name").notNull(),
  sectionDescription: text("section_description"),
  sectionWeight: integer("section_weight"), // percentage weight of this section
  sectionOrder: integer("section_order").notNull(),
  sectionRating: reviewRatingEnum("section_rating"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Review Criteria (individual items within sections)
export const reviewCriteria = pgTable("review_criteria", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id").references(() => reviewSections.id).notNull(),
  criteriaName: text("criteria_name").notNull(),
  criteriaDescription: text("criteria_description"),
  criteriaWeight: integer("criteria_weight"), // percentage weight within the section
  criteriaOrder: integer("criteria_order").notNull(),
  selfRating: reviewRatingEnum("self_rating"),
  managerRating: reviewRatingEnum("manager_rating"),
  selfComments: text("self_comments"),
  managerComments: text("manager_comments"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Goals
export const employeeGoals = pgTable("employee_goals", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // career, performance, development, etc.
  startDate: date("start_date").notNull(),
  dueDate: date("due_date").notNull(),
  completionDate: date("completion_date"),
  status: goalStatusEnum("status").notNull().default("not_started"),
  priority: goalPriorityEnum("priority").notNull().default("medium"),
  progress: integer("progress").default(0), // percentage of completion
  alignedToBusinessObjective: text("aligned_to_business_objective"),
  managerFeedback: text("manager_feedback"),
  isVisible: boolean("is_visible").default(true), // for privacy settings
  relatedReviewId: integer("related_review_id").references(() => performanceReviews.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Goal Milestones (key steps to achieve a goal)
export const goalMilestones = pgTable("goal_milestones", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").references(() => employeeGoals.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: date("due_date"),
  completionDate: date("completion_date"),
  status: taskStatusEnum("status").notNull().default("not_started"), // reusing the task status enum
  milestoneOrder: integer("milestone_order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Continuous Feedback
export const employeeFeedback = pgTable("employee_feedback", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(), // who receives the feedback
  providerId: integer("provider_id").references(() => employees.id).notNull(), // who gives the feedback
  feedbackType: feedbackTypeEnum("feedback_type").notNull(),
  content: text("content").notNull(),
  anonymous: boolean("anonymous").default(false),
  visibility: text("visibility").notNull(), // private, team, public
  relatedGoalId: integer("related_goal_id").references(() => employeeGoals.id),
  relatedReviewId: integer("related_review_id").references(() => performanceReviews.id),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgementDate: timestamp("acknowledgement_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Skills Assessment
export const skillAssessments = pgTable("skill_assessments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id).notNull(),
  skillId: integer("skill_id").references(() => employeeSkills.id).notNull(),
  assessmentDate: date("assessment_date").notNull(),
  assessorId: integer("assessor_id").references(() => employees.id),
  selfAssessmentRating: integer("self_assessment_rating"), // 1-5 scale
  managerAssessmentRating: integer("manager_assessment_rating"), // 1-5 scale
  comments: text("comments"),
  developmentPlan: text("development_plan"),
  relatedReviewId: integer("related_review_id").references(() => performanceReviews.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Create insert schemas
export const insertPerformanceReviewSchema = createInsertSchema(performanceReviews).omit({ id: true, createdAt: true, updatedAt: true });
export const insertReviewSectionSchema = createInsertSchema(reviewSections).omit({ id: true, createdAt: true, updatedAt: true });
export const insertReviewCriteriaSchema = createInsertSchema(reviewCriteria).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEmployeeGoalSchema = createInsertSchema(employeeGoals).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGoalMilestoneSchema = createInsertSchema(goalMilestones).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEmployeeFeedbackSchema = createInsertSchema(employeeFeedback).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSkillAssessmentSchema = createInsertSchema(skillAssessments).omit({ id: true, createdAt: true, updatedAt: true });

// Define types
export type InsertPerformanceReview = z.infer<typeof insertPerformanceReviewSchema>;
export type PerformanceReview = typeof performanceReviews.$inferSelect;

export type InsertReviewSection = z.infer<typeof insertReviewSectionSchema>;
export type ReviewSection = typeof reviewSections.$inferSelect;

export type InsertReviewCriteria = z.infer<typeof insertReviewCriteriaSchema>;
export type ReviewCriteria = typeof reviewCriteria.$inferSelect;

export type InsertEmployeeGoal = z.infer<typeof insertEmployeeGoalSchema>;
export type EmployeeGoal = typeof employeeGoals.$inferSelect;

export type InsertGoalMilestone = z.infer<typeof insertGoalMilestoneSchema>;
export type GoalMilestone = typeof goalMilestones.$inferSelect;

export type InsertEmployeeFeedback = z.infer<typeof insertEmployeeFeedbackSchema>;
export type EmployeeFeedback = typeof employeeFeedback.$inferSelect;

export type InsertSkillAssessment = z.infer<typeof insertSkillAssessmentSchema>;
export type SkillAssessment = typeof skillAssessments.$inferSelect;

export type InsertOnboardingTask = z.infer<typeof insertOnboardingTaskSchema>;
export type OnboardingTask = typeof onboardingTasks.$inferSelect;

// Communication Hub Types
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcements.$inferSelect;

export type InsertSlackIntegration = z.infer<typeof insertSlackIntegrationSchema>;
export type SlackIntegration = typeof slackIntegration.$inferSelect;

export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

// Define table relations
export const usersRelations = relations(users, ({ one, many }) => ({
  // employee: one(employees, {
  //   fields: [users.id],
  //   references: [employees.userId],
  // }), // Temporarily removed - userId field commented out
  activityLogs: many(activityLogs),
  notifications: many(notifications),
  authoredAnnouncements: many(announcements, { relationName: "author" }),
  slackIntegration: one(slackIntegration, {
    fields: [users.id],
    references: [slackIntegration.userId],
  }),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  // user: one(users, {
  //   fields: [employees.userId],
  //   references: [users.id],
  // }), // Temporarily removed - userId field commented out
  reportingManager: one(employees, {
    fields: [employees.reportingManagerId],
    references: [employees.id],
  }),
  secondaryManager: one(employees, {
    fields: [employees.secondaryManagerId],
    references: [employees.id],
  }),
  documents: many(documents),
  employeeDocuments: many(employeeDocuments),
  education: many(employeeEducation),
  certifications: many(employeeCertifications),
  skills: many(employeeSkills),
  languages: many(employeeLanguages),
  attendanceRecords: many(attendance),
  leaveRequests: many(leaves),
  payrollRecords: many(payroll),
  eventAssignments: many(eventStaffAssignments),
  jobRequisitions: many(jobRequisitions, { relationName: "requester" }),
  approvedRequisitions: many(jobRequisitions, { relationName: "approver" }),
  interviews: many(interviews),
  createdOffers: many(jobOffers),
  onboarding: many(employeeOnboarding),
  leaveBalances: many(leaveBalances),
  notificationPreferences: one(notificationPreferences, {
    fields: [employees.id],
    references: [notificationPreferences.employeeId],
  }),
  // Performance Management Relations
  performanceReviews: many(performanceReviews, { relationName: "reviewee" }),
  performanceReviewsAsReviewer: many(performanceReviews, { relationName: "reviewer" }),
  goals: many(employeeGoals),
  feedback: many(employeeFeedback, { relationName: "recipient" }),
  providedFeedback: many(employeeFeedback, { relationName: "provider" }),
  skillAssessments: many(skillAssessments),
}));

// Recruitment relations
export const jobRequisitionsRelations = relations(jobRequisitions, ({ one, many }) => ({
  requestedByEmployee: one(employees, {
    fields: [jobRequisitions.requestedBy],
    references: [employees.id],
    relationName: "requester",
  }),
  approvedByEmployee: one(employees, {
    fields: [jobRequisitions.approvedBy],
    references: [employees.id],
    relationName: "approver",
  }),
  jobPostings: many(jobPostings),
  applications: many(jobApplications),
}));

export const jobPostingsRelations = relations(jobPostings, ({ one }) => ({
  requisition: one(jobRequisitions, {
    fields: [jobPostings.requisitionId],
    references: [jobRequisitions.id],
  }),
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  referralEmployee: one(employees, {
    fields: [candidates.referralEmployeeId],
    references: [employees.id],
  }),
  skills: many(candidateSkills),
  experience: many(candidateExperience),
  education: many(candidateEducation),
  applications: many(jobApplications),
}));

export const candidateSkillsRelations = relations(candidateSkills, ({ one }) => ({
  candidate: one(candidates, {
    fields: [candidateSkills.candidateId],
    references: [candidates.id],
  }),
}));

export const candidateExperienceRelations = relations(candidateExperience, ({ one }) => ({
  candidate: one(candidates, {
    fields: [candidateExperience.candidateId],
    references: [candidates.id],
  }),
}));

export const candidateEducationRelations = relations(candidateEducation, ({ one }) => ({
  candidate: one(candidates, {
    fields: [candidateEducation.candidateId],
    references: [candidates.id],
  }),
}));

export const jobApplicationsRelations = relations(jobApplications, ({ one, many }) => ({
  candidate: one(candidates, {
    fields: [jobApplications.candidateId],
    references: [candidates.id],
  }),
  requisition: one(jobRequisitions, {
    fields: [jobApplications.requisitionId],
    references: [jobRequisitions.id],
  }),
  interviews: many(interviews),
  offers: many(jobOffers),
}));

export const interviewsRelations = relations(interviews, ({ one }) => ({
  application: one(jobApplications, {
    fields: [interviews.applicationId],
    references: [jobApplications.id],
  }),
  interviewer: one(employees, {
    fields: [interviews.interviewerId],
    references: [employees.id],
  }),
}));

export const jobOffersRelations = relations(jobOffers, ({ one, many }) => ({
  application: one(jobApplications, {
    fields: [jobOffers.applicationId],
    references: [jobApplications.id],
  }),
  createdByEmployee: one(employees, {
    fields: [jobOffers.createdBy],
    references: [employees.id],
  }),
  onboarding: many(employeeOnboarding),
}));

// Onboarding relations
export const onboardingChecklistsRelations = relations(onboardingChecklists, ({ many }) => ({
  tasks: many(checklistTasks),
  employeeOnboardings: many(employeeOnboarding),
}));

export const checklistTasksRelations = relations(checklistTasks, ({ one, many }) => ({
  checklist: one(onboardingChecklists, {
    fields: [checklistTasks.checklistId],
    references: [onboardingChecklists.id],
  }),
  assignedTasks: many(onboardingTasks),
}));

export const employeeOnboardingRelations = relations(employeeOnboarding, ({ one, many }) => ({
  employee: one(employees, {
    fields: [employeeOnboarding.employeeId],
    references: [employees.id],
  }),
  offer: one(jobOffers, {
    fields: [employeeOnboarding.offerId],
    references: [jobOffers.id],
  }),
  checklist: one(onboardingChecklists, {
    fields: [employeeOnboarding.checklistId],
    references: [onboardingChecklists.id],
  }),
  tasks: many(onboardingTasks),
}));

export const onboardingTasksRelations = relations(onboardingTasks, ({ one }) => ({
  onboarding: one(employeeOnboarding, {
    fields: [onboardingTasks.onboardingId],
    references: [employeeOnboarding.id],
  }),
  task: one(checklistTasks, {
    fields: [onboardingTasks.taskId],
    references: [checklistTasks.id],
  }),
  assignee: one(employees, {
    fields: [onboardingTasks.assigneeId],
    references: [employees.id],
  }),
}));

// Leave Management Relations
export const leavesRelations = relations(leaves, ({ one, many }) => ({
  employee: one(employees, {
    fields: [leaves.employeeId],
    references: [employees.id],
  }),
  approver: one(users, {
    fields: [leaves.approvedBy],
    references: [users.id],
  }),
  supportingDocuments: many(leaveSupportingDocuments),
  approvals: many(leaveApprovals),
}));

export const leaveTypesRelations = relations(leaveTypes, ({ many }) => ({
  balances: many(leaveBalances),
}));

export const leaveBalancesRelations = relations(leaveBalances, ({ one }) => ({
  employee: one(employees, {
    fields: [leaveBalances.employeeId],
    references: [employees.id],
  }),
  leaveType: one(leaveTypes, {
    fields: [leaveBalances.leaveTypeId],
    references: [leaveTypes.id],
  }),
}));

export const leaveSupportingDocumentsRelations = relations(leaveSupportingDocuments, ({ one }) => ({
  leave: one(leaves, {
    fields: [leaveSupportingDocuments.leaveId],
    references: [leaves.id],
  }),
  uploader: one(users, {
    fields: [leaveSupportingDocuments.uploadedBy],
    references: [users.id],
  }),
}));

export const leaveApprovalsRelations = relations(leaveApprovals, ({ one }) => ({
  leave: one(leaves, {
    fields: [leaveApprovals.leaveId],
    references: [leaves.id],
  }),
  approver: one(employees, {
    fields: [leaveApprovals.approverId],
    references: [employees.id],
  }),
}));

// Event Staff Management Relations
export const eventsRelations = relations(events, ({ one, many }) => ({
  creator: one(users, {
    fields: [events.createdBy],
    references: [users.id],
  }),
  roles: many(eventRoles),
  rosters: many(eventRosters),
  assignments: many(eventStaffAssignments),
  communications: many(eventCommunications),
}));

export const eventRolesRelations = relations(eventRoles, ({ one, many }) => ({
  event: one(events, {
    fields: [eventRoles.eventId],
    references: [events.id],
  }),
  assignments: many(eventStaffAssignments),
}));

export const eventStaffProfilesRelations = relations(eventStaffProfiles, ({ one }) => ({
  employee: one(employees, {
    fields: [eventStaffProfiles.employeeId],
    references: [employees.id],
  }),
}));

export const eventRostersRelations = relations(eventRosters, ({ one, many }) => ({
  event: one(events, {
    fields: [eventRosters.eventId],
    references: [events.id],
  }),
  publisher: one(users, {
    fields: [eventRosters.publishedBy],
    references: [users.id],
  }),
  assignments: many(eventStaffAssignments),
}));

export const eventStaffAssignmentsRelations = relations(eventStaffAssignments, ({ one }) => ({
  event: one(events, {
    fields: [eventStaffAssignments.eventId],
    references: [events.id],
  }),
  employee: one(employees, {
    fields: [eventStaffAssignments.employeeId],
    references: [employees.id],
  }),
}));

export const eventStaffPerformanceRelations = relations(eventStaffPerformance, ({ one }) => ({
  assignment: one(eventStaffAssignments, {
    fields: [eventStaffPerformance.assignmentId],
    references: [eventStaffAssignments.id],
  }),
  rater: one(employees, {
    fields: [eventStaffPerformance.ratedBy],
    references: [employees.id],
  }),
}));

export const eventCommunicationsRelations = relations(eventCommunications, ({ one, many }) => ({
  event: one(events, {
    fields: [eventCommunications.eventId],
    references: [events.id],
  }),
  sender: one(users, {
    fields: [eventCommunications.senderId],
    references: [users.id],
  }),
  recipients: many(eventCommunicationRecipients),
}));

export const eventCommunicationRecipientsRelations = relations(eventCommunicationRecipients, ({ one }) => ({
  communication: one(eventCommunications, {
    fields: [eventCommunicationRecipients.communicationId],
    references: [eventCommunications.id],
  }),
  recipient: one(employees, {
    fields: [eventCommunicationRecipients.recipientId],
    references: [employees.id],
  }),
}));

// Communication Hub Relations
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const announcementsRelations = relations(announcements, ({ one }) => ({
  author: one(users, {
    fields: [announcements.authorId],
    references: [users.id],
  }),
}));

export const slackIntegrationRelations = relations(slackIntegration, ({ one }) => ({
  user: one(users, {
    fields: [slackIntegration.userId],
    references: [users.id],
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  employee: one(employees, {
    fields: [notificationPreferences.employeeId],
    references: [employees.id],
  }),
}));

// Performance Management Relations
export const performanceReviewsRelations = relations(performanceReviews, ({ one, many }) => ({
  employee: one(employees, {
    fields: [performanceReviews.employeeId],
    references: [employees.id],
    relationName: "reviewee",
  }),
  reviewer: one(employees, {
    fields: [performanceReviews.reviewerId],
    references: [employees.id],
    relationName: "reviewer",
  }),
  sections: many(reviewSections),
}));

export const reviewSectionsRelations = relations(reviewSections, ({ one, many }) => ({
  review: one(performanceReviews, {
    fields: [reviewSections.reviewId],
    references: [performanceReviews.id],
  }),
  criteria: many(reviewCriteria),
}));

export const reviewCriteriaRelations = relations(reviewCriteria, ({ one }) => ({
  section: one(reviewSections, {
    fields: [reviewCriteria.sectionId],
    references: [reviewSections.id],
  }),
}));

export const employeeGoalsRelations = relations(employeeGoals, ({ one, many }) => ({
  employee: one(employees, {
    fields: [employeeGoals.employeeId],
    references: [employees.id],
  }),
  relatedReview: one(performanceReviews, {
    fields: [employeeGoals.relatedReviewId],
    references: [performanceReviews.id],
  }),
  milestones: many(goalMilestones),
}));

export const goalMilestonesRelations = relations(goalMilestones, ({ one }) => ({
  goal: one(employeeGoals, {
    fields: [goalMilestones.goalId],
    references: [employeeGoals.id],
  }),
}));

export const employeeFeedbackRelations = relations(employeeFeedback, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeFeedback.employeeId],
    references: [employees.id],
    relationName: "recipient",
  }),
  provider: one(employees, {
    fields: [employeeFeedback.providerId],
    references: [employees.id],
    relationName: "provider",
  }),
  relatedGoal: one(employeeGoals, {
    fields: [employeeFeedback.relatedGoalId],
    references: [employeeGoals.id],
  }),
  relatedReview: one(performanceReviews, {
    fields: [employeeFeedback.relatedReviewId],
    references: [performanceReviews.id],
  }),
}));

export const skillAssessmentsRelations = relations(skillAssessments, ({ one }) => ({
  employee: one(employees, {
    fields: [skillAssessments.employeeId],
    references: [employees.id],
  }),
  skill: one(employeeSkills, {
    fields: [skillAssessments.skillId],
    references: [employeeSkills.id],
  }),
  assessor: one(employees, {
    fields: [skillAssessments.assessorId],
    references: [employees.id],
  }),
  relatedReview: one(performanceReviews, {
    fields: [skillAssessments.relatedReviewId],
    references: [performanceReviews.id],
  }),
}));

// Reports & Analytics Module

// Report visualization type enum
export const visualizationTypeEnum = pgEnum('visualization_type', ['table', 'bar_chart', 'line_chart', 'pie_chart', 'area_chart', 'scatter_plot', 'map', 'heatmap', 'kpi']);

// Report schedules frequency enum
export const reportScheduleFrequencyEnum = pgEnum('report_schedule_frequency', ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'once']);

// Custom report definitions
export const reportDefinitions = pgTable("report_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id).notNull(),
  isPublic: boolean("is_public").default(false),
  lastRun: timestamp("last_run"),
  queryDefinition: jsonb("query_definition").notNull(), // Stores tables, fields, filters, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Report visualizations
export const reportVisualizations = pgTable("report_visualizations", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => reportDefinitions.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: visualizationTypeEnum("type").notNull(),
  config: jsonb("config").notNull(), // Chart configuration, axes, colors, etc.
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Report schedules
export const reportSchedules = pgTable("report_schedules", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => reportDefinitions.id).notNull(),
  name: text("name").notNull(),
  frequency: reportScheduleFrequencyEnum("frequency").notNull(),
  nextRunDate: timestamp("next_run_date").notNull(),
  recipients: text("recipients").array(), // Array of email addresses
  exportFormat: text("export_format").default("pdf"), // pdf, excel, csv
  active: boolean("active").default(true),
  createdBy: integer("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Dashboards
export const dashboards = pgTable("dashboards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  layout: jsonb("layout"), // Dashboard layout configuration
  isDefault: boolean("is_default").default(false),
  createdBy: integer("created_by").references(() => users.id).notNull(),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Dashboard widgets
export const dashboardWidgets = pgTable("dashboard_widgets", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id").references(() => dashboards.id).notNull(),
  title: text("title").notNull(),
  type: visualizationTypeEnum("type").notNull(),
  reportVisualizationId: integer("report_visualization_id").references(() => reportVisualizations.id),
  customConfig: jsonb("custom_config"), // For widgets not based on report visualizations
  refreshInterval: integer("refresh_interval"), // In minutes
  position: jsonb("position").notNull(), // x, y, width, height
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Save report history
export const reportExecutionHistory = pgTable("report_execution_history", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => reportDefinitions.id).notNull(),
  executedBy: integer("executed_by").references(() => users.id),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
  parameters: jsonb("parameters"), // Parameters used for the execution
  resultCount: integer("result_count"),
  executionTime: integer("execution_time"), // In milliseconds
  status: text("status").notNull(), // success, failed
  errorMessage: text("error_message"),
  exportFormat: text("export_format"), // If exported: pdf, excel, csv
  exportPath: text("export_path"), // Path to exported file
});

// Create insert schemas
export const insertReportDefinitionSchema = createInsertSchema(reportDefinitions, {
  queryDefinition: z.any(),
}).omit({ id: true, createdAt: true, updatedAt: true, lastRun: true });

export const insertReportVisualizationSchema = createInsertSchema(reportVisualizations, {
  config: z.any(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertReportScheduleSchema = createInsertSchema(reportSchedules, {
  recipients: z.array(z.string().email()),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertDashboardSchema = createInsertSchema(dashboards, {
  layout: z.any(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertDashboardWidgetSchema = createInsertSchema(dashboardWidgets, {
  position: z.any(),
  customConfig: z.any().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// Relations
export const reportDefinitionsRelations = relations(reportDefinitions, ({ one, many }) => ({
  creator: one(users, {
    fields: [reportDefinitions.createdBy],
    references: [users.id],
  }),
  visualizations: many(reportVisualizations),
  schedules: many(reportSchedules),
  executionHistory: many(reportExecutionHistory),
}));

export const reportVisualizationsRelations = relations(reportVisualizations, ({ one, many }) => ({
  report: one(reportDefinitions, {
    fields: [reportVisualizations.reportId],
    references: [reportDefinitions.id],
  }),
  dashboardWidgets: many(dashboardWidgets),
}));

export const reportSchedulesRelations = relations(reportSchedules, ({ one }) => ({
  report: one(reportDefinitions, {
    fields: [reportSchedules.reportId],
    references: [reportDefinitions.id],
  }),
  creator: one(users, {
    fields: [reportSchedules.createdBy],
    references: [users.id],
  }),
}));

export const dashboardsRelations = relations(dashboards, ({ one, many }) => ({
  creator: one(users, {
    fields: [dashboards.createdBy],
    references: [users.id],
  }),
  widgets: many(dashboardWidgets),
}));

export const dashboardWidgetsRelations = relations(dashboardWidgets, ({ one }) => ({
  dashboard: one(dashboards, {
    fields: [dashboardWidgets.dashboardId],
    references: [dashboards.id],
  }),
  visualization: one(reportVisualizations, {
    fields: [dashboardWidgets.reportVisualizationId],
    references: [reportVisualizations.id],
  }),
}));

export const reportExecutionHistoryRelations = relations(reportExecutionHistory, ({ one }) => ({
  report: one(reportDefinitions, {
    fields: [reportExecutionHistory.reportId],
    references: [reportDefinitions.id],
  }),
  executor: one(users, {
    fields: [reportExecutionHistory.executedBy],
    references: [users.id],
  }),
}));

// Role & Permission Management Relations
export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  users: many(userRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  assignedByUser: one(users, {
    fields: [userRoles.assignedBy],
    references: [users.id],
  }),
}));

export const securityLogsRelations = relations(securityLogs, ({ one }) => ({
  user: one(users, {
    fields: [securityLogs.userId],
    references: [users.id],
  }),
}));

// Skills management schema
export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const roleSkills = pgTable("role_skills", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  skillId: integer("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  requiredProficiencyLevel: integer("required_proficiency_level").notNull(),
  importance: text("importance", { enum: ["critical", "important", "nice_to_have"] }).default("important").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const employeeSkills = pgTable("employee_skills", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  skillId: integer("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  proficiencyLevel: integer("proficiency_level").notNull(), // 1-5 scale
  certified: boolean("certified").default(false),
  certificationDate: timestamp("certification_date"),
  certificationExpiry: timestamp("certification_expiry"),
  notes: text("notes"),
  lastAssessed: timestamp("last_assessed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Create insert schema for employee skills
export const insertEmployeeSkillSchema = createInsertSchema(employeeSkills).omit({
  id: true, 
  createdAt: true,
  updatedAt: true,
});

export const trainingCourses = pgTable("training_courses", {
  id: serial("id").primaryKey(),
  externalCourseId: text("external_course_id"), // ID in external LMS
  title: text("title").notNull(),
  description: text("description"),
  provider: text("provider"),
  skillIds: text("skill_ids").array(), // Array of skill IDs this course addresses
  duration: integer("duration"), // Duration in minutes
  format: text("format", { enum: ["online", "in_person", "hybrid", "self_paced"] }),
  level: text("level", { enum: ["beginner", "intermediate", "advanced"] }),
  url: text("url"),
  cost: decimal("cost"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const employeeTraining = pgTable("employee_training", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  courseId: integer("course_id").notNull().references(() => trainingCourses.id, { onDelete: "cascade" }),
  enrollmentDate: timestamp("enrollment_date").defaultNow().notNull(),
  completionDate: timestamp("completion_date"),
  status: text("status", { enum: ["enrolled", "in_progress", "completed", "failed", "withdrawn"] }).default("enrolled").notNull(),
  progress: integer("progress").default(0), // Progress percentage 0-100
  score: integer("score"),
  certificateUrl: text("certificate_url"),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Create insert schema for training courses
export const insertTrainingCourseSchema = createInsertSchema(trainingCourses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Create insert schema for employee training
export const insertEmployeeTrainingSchema = createInsertSchema(employeeTraining).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Skills Relations
export const skillsRelations = relations(skills, ({ many }) => ({
  roleSkills: many(roleSkills),
  employeeSkills: many(employeeSkills),
}));

export const roleSkillsRelations = relations(roleSkills, ({ one }) => ({
  skill: one(skills, {
    fields: [roleSkills.skillId],
    references: [skills.id],
  }),
  role: one(roles, {
    fields: [roleSkills.roleId],
    references: [roles.id],
  }),
}));

export const employeeSkillsRelations = relations(employeeSkills, ({ one }) => ({
  skill: one(skills, {
    fields: [employeeSkills.skillId],
    references: [skills.id],
  }),
  employee: one(employees, {
    fields: [employeeSkills.employeeId],
    references: [employees.id],
  }),
}));

export const trainingCoursesRelations = relations(trainingCourses, ({ many }) => ({
  employeeTrainings: many(employeeTraining),
}));

export const employeeTrainingRelations = relations(employeeTraining, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeTraining.employeeId],
    references: [employees.id],
  }),
  course: one(trainingCourses, {
    fields: [employeeTraining.courseId],
    references: [trainingCourses.id],
  }),
}));

// Role & Permission Management Insert Schemas
export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({
  id: true,
  createdAt: true,
});

export const insertUserRoleSchema = createInsertSchema(userRoles).omit({
  id: true,
  assignedAt: true,
});

export const insertSecurityLogSchema = createInsertSchema(securityLogs).omit({
  id: true,
  timestamp: true,
  createdAt: true,
});

// Role & Permission Management Types
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRoleAssignment = typeof userRoles.$inferSelect;

export type InsertSecurityLog = z.infer<typeof insertSecurityLogSchema>;
export type SecurityLog = typeof securityLogs.$inferSelect;

// Training & Skill Gap Types
export type InsertTrainingCourse = z.infer<typeof insertTrainingCourseSchema>;
export type TrainingCourse = typeof trainingCourses.$inferSelect;

export type InsertEmployeeTraining = z.infer<typeof insertEmployeeTrainingSchema>;
export type EmployeeTraining = typeof employeeTraining.$inferSelect;

// Schema exports for bulk import
export const insertBulkImportJobSchema = createInsertSchema(bulkImportJobs).omit({ id: true, createdAt: true, completedAt: true });

// Type exports for bulk import
export type InsertBulkImportJob = z.infer<typeof insertBulkImportJobSchema>;
export type SelectBulkImportJob = typeof bulkImportJobs.$inferSelect;

export const appSettings = pgTable("app_settings", {key:text("key").primaryKey(),value:jsonb("value").notNull(),updatedAt:timestamp("updated_at").defaultNow().notNull()});
