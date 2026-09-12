import type { UserRole } from './schema';

// Permission types based on the access control matrix
export type Permission = 'create' | 'read' | 'update' | 'delete' | 'approve' | 'admin' | 'none';

// HR system modules
export type HRModule = 
  | 'employee_database'
  | 'recruitment_onboarding'
  | 'attendance_time_tracking'
  | 'payroll_management'
  | 'leave_absence_management'
  | 'event_staff_management'
  | 'compliance_documents'
  | 'communication_hub'
  | 'performance_management'
  | 'reports_analytics'
  | 'training_development'
  | 'benefits_perks'
  | 'system_configuration';

// Scope types for data access
export type AccessScope = 'all' | 'department' | 'team' | 'event_staff' | 'self' | 'none';

export interface RolePermissions {
  permissions: Permission[];
  scope: AccessScope;
  description: string;
}

// Comprehensive role-based access control matrix
export const ROLE_PERMISSIONS: Record<UserRole, Record<HRModule, RolePermissions>> = {
  super_admin: {
    employee_database: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Full administrative access to all employee data' },
    recruitment_onboarding: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Complete recruitment system administration' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Full attendance system control' },
    payroll_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Complete payroll system administration' },
    leave_absence_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Full leave management control' },
    event_staff_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Complete event staff system administration' },
    compliance_documents: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Full compliance system control' },
    communication_hub: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Complete communication system administration' },
    performance_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Full performance system control' },
    reports_analytics: { permissions: ['read', 'admin'], scope: 'all', description: 'Access to all reports and analytics' },
    training_development: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Complete training system administration' },
    benefits_perks: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Full benefits system control' },
    system_configuration: { permissions: ['admin'], scope: 'all', description: 'System configuration and maintenance' }
  },

  c_level_executive: {
    employee_database: { permissions: ['read'], scope: 'all', description: 'Aggregate view of employee data for strategic decisions' },
    recruitment_onboarding: { permissions: ['none'], scope: 'none', description: 'No operational recruitment access' },
    attendance_time_tracking: { permissions: ['read'], scope: 'all', description: 'Dashboard view of attendance metrics' },
    payroll_management: { permissions: ['read'], scope: 'all', description: 'High-level payroll cost overview' },
    leave_absence_management: { permissions: ['read'], scope: 'all', description: 'Dashboard view of leave trends' },
    event_staff_management: { permissions: ['none'], scope: 'none', description: 'No event staff management access' },
    compliance_documents: { permissions: ['none'], scope: 'none', description: 'No operational compliance access' },
    communication_hub: { permissions: ['read'], scope: 'all', description: 'View organization-wide communications' },
    performance_management: { permissions: ['read'], scope: 'all', description: 'Dashboard view of performance metrics' },
    reports_analytics: { permissions: ['read'], scope: 'all', description: 'Access to all strategic reports' },
    training_development: { permissions: ['read'], scope: 'all', description: 'Dashboard view of training metrics' },
    benefits_perks: { permissions: ['read'], scope: 'all', description: 'Overview of benefits costs and utilization' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  hr_director: {
    employee_database: { permissions: ['create', 'read', 'update', 'delete'], scope: 'all', description: 'Full employee data management organization-wide' },
    recruitment_onboarding: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Complete recruitment oversight and policy setting' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Full attendance management and policy control' },
    payroll_management: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Strategic payroll oversight and approval authority' },
    leave_absence_management: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Complete leave policy management and oversight' },
    event_staff_management: { permissions: ['create', 'read', 'update', 'delete'], scope: 'all', description: 'Strategic oversight of event staff operations' },
    compliance_documents: { permissions: ['admin'], scope: 'all', description: 'Full compliance system configuration and oversight' },
    communication_hub: { permissions: ['admin'], scope: 'all', description: 'Complete communication system control' },
    performance_management: { permissions: ['admin'], scope: 'all', description: 'Performance system configuration and oversight' },
    reports_analytics: { permissions: ['admin'], scope: 'all', description: 'Access to all HR reports and analytics configuration' },
    training_development: { permissions: ['admin'], scope: 'all', description: 'Training program oversight and configuration' },
    benefits_perks: { permissions: ['admin'], scope: 'all', description: 'Benefits program configuration and management' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No technical system configuration access' }
  },

  hr_manager: {
    employee_database: { permissions: ['create', 'read', 'update', 'delete'], scope: 'department', description: 'Employee management within assigned departments' },
    recruitment_onboarding: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'department', description: 'Recruitment management for assigned departments' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'department', description: 'Attendance oversight for assigned departments' },
    payroll_management: { permissions: ['read'], scope: 'department', description: 'Payroll review for assigned departments' },
    leave_absence_management: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'department', description: 'Leave management for assigned departments' },
    event_staff_management: { permissions: ['create', 'read', 'update'], scope: 'all', description: 'Event staff coordination and management' },
    compliance_documents: { permissions: ['create', 'read', 'update', 'delete'], scope: 'department', description: 'Compliance management for assigned areas' },
    communication_hub: { permissions: ['create'], scope: 'department', description: 'Communications for assigned departments' },
    performance_management: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'department', description: 'Performance management for assigned departments' },
    reports_analytics: { permissions: ['read'], scope: 'department', description: 'Reports for assigned departments' },
    training_development: { permissions: ['create', 'read', 'update', 'delete'], scope: 'department', description: 'Training coordination for assigned departments' },
    benefits_perks: { permissions: ['create', 'read', 'update', 'delete'], scope: 'department', description: 'Benefits administration for assigned departments' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  recruiter: {
    employee_database: { permissions: ['read'], scope: 'all', description: 'Limited employee data access for recruitment purposes' },
    recruitment_onboarding: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Full recruitment pipeline management' },
    attendance_time_tracking: { permissions: ['none'], scope: 'none', description: 'No attendance management access' },
    payroll_management: { permissions: ['none'], scope: 'none', description: 'No payroll access' },
    leave_absence_management: { permissions: ['none'], scope: 'none', description: 'No leave management access' },
    event_staff_management: { permissions: ['read'], scope: 'event_staff', description: 'View event staff pool for recruitment' },
    compliance_documents: { permissions: ['read', 'update'], scope: 'all', description: 'Onboarding document management' },
    communication_hub: { permissions: ['create'], scope: 'all', description: 'Candidate and recruitment communications' },
    performance_management: { permissions: ['none'], scope: 'none', description: 'No performance management access' },
    reports_analytics: { permissions: ['read'], scope: 'all', description: 'Recruitment analytics and reports' },
    training_development: { permissions: ['none'], scope: 'none', description: 'No training access' },
    benefits_perks: { permissions: ['none'], scope: 'none', description: 'No benefits access' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  payroll_specialist: {
    employee_database: { permissions: ['read'], scope: 'all', description: 'Employee data access for payroll processing' },
    recruitment_onboarding: { permissions: ['none'], scope: 'none', description: 'No recruitment access' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Attendance data for payroll calculations' },
    payroll_management: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Complete payroll processing and management' },
    leave_absence_management: { permissions: ['read'], scope: 'all', description: 'Leave data for payroll impact' },
    event_staff_management: { permissions: ['read'], scope: 'event_staff', description: 'Event staff payment rates and processing' },
    compliance_documents: { permissions: ['read'], scope: 'all', description: 'Payroll-related compliance documents' },
    communication_hub: { permissions: ['create'], scope: 'all', description: 'Payroll-related communications' },
    performance_management: { permissions: ['none'], scope: 'none', description: 'No performance management access' },
    reports_analytics: { permissions: ['read'], scope: 'all', description: 'Payroll and financial reports' },
    training_development: { permissions: ['none'], scope: 'none', description: 'No training access' },
    benefits_perks: { permissions: ['read'], scope: 'all', description: 'Benefits data for payroll processing' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  department_head: {
    employee_database: { permissions: ['read'], scope: 'team', description: 'Team member profiles and basic information' },
    recruitment_onboarding: { permissions: ['read', 'update', 'approve'], scope: 'team', description: 'Team recruitment approval and onboarding oversight' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'approve'], scope: 'team', description: 'Team attendance oversight and approval' },
    payroll_management: { permissions: ['read'], scope: 'team', description: 'Team compensation overview (not detailed amounts)' },
    leave_absence_management: { permissions: ['create', 'read', 'approve'], scope: 'team', description: 'Team leave request approval and management' },
    event_staff_management: { permissions: ['none'], scope: 'none', description: 'No event staff access' },
    compliance_documents: { permissions: ['read'], scope: 'team', description: 'Team compliance document access' },
    communication_hub: { permissions: ['create'], scope: 'team', description: 'Team communications and announcements' },
    performance_management: { permissions: ['create', 'read', 'update', 'approve'], scope: 'team', description: 'Team performance reviews and goal setting' },
    reports_analytics: { permissions: ['read'], scope: 'team', description: 'Team performance and productivity reports' },
    training_development: { permissions: ['create', 'read', 'approve'], scope: 'team', description: 'Team training coordination and approval' },
    benefits_perks: { permissions: ['read'], scope: 'team', description: 'Team benefits overview' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  event_manager: {
    employee_database: { permissions: ['read'], scope: 'event_staff', description: 'Event staff profiles and availability' },
    recruitment_onboarding: { permissions: ['none'], scope: 'none', description: 'No permanent staff recruitment access' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'approve'], scope: 'event_staff', description: 'Event staff attendance and time tracking' },
    payroll_management: { permissions: ['none'], scope: 'none', description: 'No payroll access' },
    leave_absence_management: { permissions: ['none'], scope: 'none', description: 'No leave management access' },
    event_staff_management: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'event_staff', description: 'Complete event staff management and coordination' },
    compliance_documents: { permissions: ['read'], scope: 'event_staff', description: 'Event staff compliance documents' },
    communication_hub: { permissions: ['create'], scope: 'event_staff', description: 'Event staff communications' },
    performance_management: { permissions: ['create', 'read', 'update', 'approve'], scope: 'event_staff', description: 'Event staff performance tracking and ratings' },
    reports_analytics: { permissions: ['read'], scope: 'event_staff', description: 'Event staff reports and analytics' },
    training_development: { permissions: ['create', 'read', 'update'], scope: 'event_staff', description: 'Event staff training coordination' },
    benefits_perks: { permissions: ['none'], scope: 'none', description: 'No benefits access' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  finance_audit: {
    employee_database: { permissions: ['none'], scope: 'none', description: 'No employee personal data access' },
    recruitment_onboarding: { permissions: ['none'], scope: 'none', description: 'No recruitment access' },
    attendance_time_tracking: { permissions: ['read'], scope: 'all', description: 'Attendance data for audit purposes' },
    payroll_management: { permissions: ['read'], scope: 'all', description: 'Read-only payroll access for auditing' },
    leave_absence_management: { permissions: ['none'], scope: 'none', description: 'No leave management access' },
    event_staff_management: { permissions: ['none'], scope: 'none', description: 'No event staff access' },
    compliance_documents: { permissions: ['read'], scope: 'all', description: 'Compliance document review for auditing' },
    communication_hub: { permissions: ['none'], scope: 'none', description: 'No communication access' },
    performance_management: { permissions: ['none'], scope: 'none', description: 'No performance access' },
    reports_analytics: { permissions: ['read'], scope: 'all', description: 'Financial and compliance reports for auditing' },
    training_development: { permissions: ['none'], scope: 'none', description: 'No training access' },
    benefits_perks: { permissions: ['read'], scope: 'all', description: 'Benefits cost analysis for auditing' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  permanent_employee: {
    employee_database: { permissions: ['read', 'update'], scope: 'self', description: 'Own profile management and updates' },
    recruitment_onboarding: { permissions: ['read'], scope: 'self', description: 'View referral opportunities' },
    attendance_time_tracking: { permissions: ['read'], scope: 'self', description: 'Own attendance history and clock-in/out' },
    payroll_management: { permissions: ['read'], scope: 'self', description: 'Own payslips and compensation information' },
    leave_absence_management: { permissions: ['create', 'read'], scope: 'self', description: 'Submit and track own leave requests' },
    event_staff_management: { permissions: ['none'], scope: 'none', description: 'No event staff access' },
    compliance_documents: { permissions: ['create', 'read', 'update'], scope: 'self', description: 'Manage own documents and certifications' },
    communication_hub: { permissions: ['read'], scope: 'all', description: 'Receive company communications' },
    performance_management: { permissions: ['create', 'read', 'update'], scope: 'self', description: 'Own performance reviews and goal tracking' },
    reports_analytics: { permissions: ['read'], scope: 'self', description: 'Own performance and attendance reports' },
    training_development: { permissions: ['create', 'read', 'update'], scope: 'self', description: 'Own training records and requests' },
    benefits_perks: { permissions: ['create', 'read', 'update'], scope: 'self', description: 'Own benefits enrollment and management' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  temporary_staff: {
    employee_database: { permissions: ['read', 'update'], scope: 'self', description: 'Own basic profile information' },
    recruitment_onboarding: { permissions: ['none'], scope: 'none', description: 'No recruitment access' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update'], scope: 'self', description: 'Own timesheet submission and tracking' },
    payroll_management: { permissions: ['read'], scope: 'self', description: 'Own payment information' },
    leave_absence_management: { permissions: ['none'], scope: 'none', description: 'No formal leave process' },
    event_staff_management: { permissions: ['read', 'update'], scope: 'self', description: 'Own availability and event assignments' },
    compliance_documents: { permissions: ['create', 'read', 'update'], scope: 'self', description: 'Own required documents' },
    communication_hub: { permissions: ['read'], scope: 'all', description: 'Event-specific communications' },
    performance_management: { permissions: ['read'], scope: 'self', description: 'Own event performance ratings' },
    reports_analytics: { permissions: ['read'], scope: 'self', description: 'Own work history and ratings' },
    training_development: { permissions: ['create', 'read', 'update'], scope: 'self', description: 'Event-specific training requirements' },
    benefits_perks: { permissions: ['none'], scope: 'none', description: 'No benefits access' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'No system configuration access' }
  },

  // Legacy roles for backwards compatibility
  employee: {
    employee_database: { permissions: ['read', 'update'], scope: 'self', description: 'Legacy: Own profile access' },
    recruitment_onboarding: { permissions: ['none'], scope: 'none', description: 'Legacy: No recruitment access' },
    attendance_time_tracking: { permissions: ['read'], scope: 'self', description: 'Legacy: Own attendance' },
    payroll_management: { permissions: ['read'], scope: 'self', description: 'Legacy: Own payroll info' },
    leave_absence_management: { permissions: ['create', 'read'], scope: 'self', description: 'Legacy: Own leave requests' },
    event_staff_management: { permissions: ['none'], scope: 'none', description: 'Legacy: No event access' },
    compliance_documents: { permissions: ['read', 'update'], scope: 'self', description: 'Legacy: Own documents' },
    communication_hub: { permissions: ['read'], scope: 'all', description: 'Legacy: Communications' },
    performance_management: { permissions: ['read', 'update'], scope: 'self', description: 'Legacy: Own performance' },
    reports_analytics: { permissions: ['read'], scope: 'self', description: 'Legacy: Own reports' },
    training_development: { permissions: ['read', 'update'], scope: 'self', description: 'Legacy: Own training' },
    benefits_perks: { permissions: ['read', 'update'], scope: 'self', description: 'Legacy: Own benefits' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'Legacy: No config access' }
  },

  admin: {
    employee_database: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full employee access' },
    recruitment_onboarding: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full recruitment access' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full attendance access' },
    payroll_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full payroll access' },
    leave_absence_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full leave access' },
    event_staff_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full event access' },
    compliance_documents: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full compliance access' },
    communication_hub: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full communication access' },
    performance_management: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full performance access' },
    reports_analytics: { permissions: ['read', 'admin'], scope: 'all', description: 'Legacy: Full analytics access' },
    training_development: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full training access' },
    benefits_perks: { permissions: ['create', 'read', 'update', 'delete', 'admin'], scope: 'all', description: 'Legacy: Full benefits access' },
    system_configuration: { permissions: ['admin'], scope: 'all', description: 'Legacy: System configuration' }
  },

  hr: {
    employee_database: { permissions: ['create', 'read', 'update', 'delete'], scope: 'all', description: 'Legacy: HR employee access' },
    recruitment_onboarding: { permissions: ['create', 'read', 'update', 'delete', 'approve'], scope: 'all', description: 'Legacy: HR recruitment access' },
    attendance_time_tracking: { permissions: ['create', 'read', 'update', 'approve'], scope: 'all', description: 'Legacy: HR attendance access' },
    payroll_management: { permissions: ['read'], scope: 'all', description: 'Legacy: HR payroll view' },
    leave_absence_management: { permissions: ['create', 'read', 'update', 'approve'], scope: 'all', description: 'Legacy: HR leave access' },
    event_staff_management: { permissions: ['create', 'read', 'update'], scope: 'all', description: 'Legacy: HR event access' },
    compliance_documents: { permissions: ['create', 'read', 'update', 'delete'], scope: 'all', description: 'Legacy: HR compliance access' },
    communication_hub: { permissions: ['create', 'read', 'update'], scope: 'all', description: 'Legacy: HR communication access' },
    performance_management: { permissions: ['create', 'read', 'update', 'approve'], scope: 'all', description: 'Legacy: HR performance access' },
    reports_analytics: { permissions: ['read'], scope: 'all', description: 'Legacy: HR analytics access' },
    training_development: { permissions: ['create', 'read', 'update'], scope: 'all', description: 'Legacy: HR training access' },
    benefits_perks: { permissions: ['create', 'read', 'update'], scope: 'all', description: 'Legacy: HR benefits access' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'Legacy: No config access' }
  },

  finance: {
    employee_database: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance employee view' },
    recruitment_onboarding: { permissions: ['none'], scope: 'none', description: 'Legacy: No recruitment access' },
    attendance_time_tracking: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance attendance view' },
    payroll_management: { permissions: ['create', 'read', 'update', 'approve'], scope: 'all', description: 'Legacy: Finance payroll access' },
    leave_absence_management: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance leave view' },
    event_staff_management: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance event view' },
    compliance_documents: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance compliance view' },
    communication_hub: { permissions: ['create'], scope: 'all', description: 'Legacy: Finance communications' },
    performance_management: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance performance view' },
    reports_analytics: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance analytics access' },
    training_development: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance training view' },
    benefits_perks: { permissions: ['read'], scope: 'all', description: 'Legacy: Finance benefits view' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'Legacy: No config access' }
  },

  manager: {
    employee_database: { permissions: ['read'], scope: 'team', description: 'Legacy: Manager team view' },
    recruitment_onboarding: { permissions: ['read', 'approve'], scope: 'team', description: 'Legacy: Manager recruitment approval' },
    attendance_time_tracking: { permissions: ['read', 'approve'], scope: 'team', description: 'Legacy: Manager attendance approval' },
    payroll_management: { permissions: ['read'], scope: 'team', description: 'Legacy: Manager payroll view' },
    leave_absence_management: { permissions: ['read', 'approve'], scope: 'team', description: 'Legacy: Manager leave approval' },
    event_staff_management: { permissions: ['none'], scope: 'none', description: 'Legacy: No event access' },
    compliance_documents: { permissions: ['read'], scope: 'team', description: 'Legacy: Manager compliance view' },
    communication_hub: { permissions: ['create'], scope: 'team', description: 'Legacy: Manager communications' },
    performance_management: { permissions: ['create', 'read', 'update', 'approve'], scope: 'team', description: 'Legacy: Manager performance access' },
    reports_analytics: { permissions: ['read'], scope: 'team', description: 'Legacy: Manager analytics access' },
    training_development: { permissions: ['read', 'approve'], scope: 'team', description: 'Legacy: Manager training approval' },
    benefits_perks: { permissions: ['read'], scope: 'team', description: 'Legacy: Manager benefits view' },
    system_configuration: { permissions: ['none'], scope: 'none', description: 'Legacy: No config access' }
  }
};

// Helper functions for permission checking
export function hasPermission(role: UserRole, module: HRModule, permission: Permission): boolean {
  const rolePermissions = ROLE_PERMISSIONS[role]?.[module];
  if (!rolePermissions) return false;
  
  if (permission === 'none') return rolePermissions.permissions.includes('none');
  if (rolePermissions.permissions.includes('admin')) return true;
  return rolePermissions.permissions.includes(permission);
}

export function getAccessScope(role: UserRole, module: HRModule): AccessScope {
  return ROLE_PERMISSIONS[role]?.[module]?.scope || 'none';
}

export function canAccessModule(role: UserRole, module: HRModule): boolean {
  const rolePermissions = ROLE_PERMISSIONS[role]?.[module];
  return rolePermissions ? !rolePermissions.permissions.includes('none') : false;
}

export function getModuleDescription(role: UserRole, module: HRModule): string {
  return ROLE_PERMISSIONS[role]?.[module]?.description || '';
}

// Get all modules a role can access
export function getAccessibleModules(role: UserRole): HRModule[] {
  return Object.keys(ROLE_PERMISSIONS[role]).filter(module => 
    canAccessModule(role, module as HRModule)
  ) as HRModule[];
}

// Check if user can perform specific actions on data scope
export function canAccessData(
  role: UserRole, 
  module: HRModule, 
  dataScope: 'own' | 'team' | 'department' | 'all',
  userId?: string,
  targetUserId?: string,
  userDepartment?: string,
  targetDepartment?: string
): boolean {
  if (!canAccessModule(role, module)) return false;
  
  const accessScope = getAccessScope(role, module);
  
  switch (accessScope) {
    case 'all':
      return true;
    case 'department':
      return dataScope === 'own' || 
             (dataScope === 'department' && userDepartment === targetDepartment) ||
             (dataScope === 'team' && userDepartment === targetDepartment);
    case 'team':
      return dataScope === 'own' || dataScope === 'team';
    case 'event_staff':
      return dataScope === 'own' || dataScope === 'team'; // Event staff scope
    case 'self':
      return dataScope === 'own' && userId === targetUserId;
    case 'none':
    default:
      return false;
  }
}