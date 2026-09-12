import type { UserRole } from './schema';

/**
 * Maps employee types to proper system roles for the comprehensive permission system
 */
export function mapEmployeeTypeToRole(employeeType: string): UserRole {
  switch (employeeType.toLowerCase()) {
    case 'temporary':
      return 'temporary_staff';
    case 'permanent':
      return 'permanent_employee';
    case 'contract':
      return 'permanent_employee'; // Contract employees get same permissions as permanent
    default:
      return 'permanent_employee'; // Default fallback
  }
}

/**
 * Maps legacy roles to new comprehensive roles
 */
export function mapLegacyRole(role: string): UserRole {
  switch (role.toLowerCase()) {
    case 'admin':
      return 'super_admin';
    case 'hr':
      return 'hr_manager';
    case 'manager':
      return 'department_head';
    case 'finance':
      return 'payroll_specialist';
    case 'employee':
      return 'permanent_employee'; // Legacy employee defaults to permanent
    default:
      return role as UserRole;
  }
}

/**
 * Gets the appropriate role based on both employee type and position
 */
export function determineUserRole(employeeType?: string, position?: string, legacyRole?: string): UserRole {
  // If a legacy role is provided, map it first
  if (legacyRole) {
    return mapLegacyRole(legacyRole);
  }
  
  // Check for special positions that override employee type
  if (position) {
    const positionLower = position.toLowerCase();
    
    // HR positions
    if (positionLower.includes('hr director') || positionLower.includes('head of hr')) {
      return 'hr_director';
    }
    if (positionLower.includes('hr manager') || positionLower.includes('human resources manager')) {
      return 'hr_manager';
    }
    if (positionLower.includes('recruiter') || positionLower.includes('recruitment')) {
      return 'recruiter';
    }
    
    // Finance positions
    if (positionLower.includes('payroll specialist') || positionLower.includes('payroll manager')) {
      return 'payroll_specialist';
    }
    if (positionLower.includes('finance director') || positionLower.includes('cfo') || positionLower.includes('financial controller')) {
      return 'finance_audit';
    }
    
    // Executive positions
    if (positionLower.includes('ceo') || positionLower.includes('cto') || positionLower.includes('director') || positionLower.includes('executive')) {
      return 'c_level_executive';
    }
    
    // Management positions
    if (positionLower.includes('department head') || positionLower.includes('department manager') || positionLower.includes('team lead')) {
      return 'department_head';
    }
    
    // Event positions
    if (positionLower.includes('event manager') || positionLower.includes('event coordinator')) {
      return 'event_manager';
    }
    
    // System admin positions
    if (positionLower.includes('system admin') || positionLower.includes('it admin') || positionLower.includes('administrator')) {
      return 'super_admin';
    }
  }
  
  // Fall back to employee type mapping
  if (employeeType) {
    return mapEmployeeTypeToRole(employeeType);
  }
  
  // Ultimate fallback
  return 'permanent_employee';
}

/**
 * Validates if a role has the minimum required permissions for their employee type
 */
export function validateRoleForEmployeeType(role: UserRole, employeeType: string): boolean {
  const mappedRole = mapEmployeeTypeToRole(employeeType);
  
  // Temporary staff should only have temporary_staff role
  if (employeeType === 'temporary' && role !== 'temporary_staff') {
    return false;
  }
  
  return true;
}