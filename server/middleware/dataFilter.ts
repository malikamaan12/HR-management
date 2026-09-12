import { Request } from 'express';
import { UserRole } from '@shared/schema';
import { hasPermission, getAccessScope, type HRModule, type Permission, type AccessScope } from '@shared/permissions';

export interface DataFilterOptions {
  userId: number;
  userRole: UserRole;
  userDepartment?: string;
  userTeam?: string;
  requestedResource: HRModule;
  requestedPermission: Permission;
}

export interface FilterResult {
  canAccess: boolean;
  scope: AccessScope;
  filters: {
    employeeId?: number;
    department?: string;
    team?: string;
    eventStaffOnly?: boolean;
  };
}

/**
 * Comprehensive data filtering service that implements role-based access control
 * with proper scope restrictions for all HR modules
 */
export class DataFilterService {
  
  /**
   * Determines if a user can access a resource and returns appropriate filters
   */
  static getDataFilter(options: DataFilterOptions): FilterResult {
    const { userId, userRole, userDepartment, requestedResource, requestedPermission } = options;
    
    // Check if user has the requested permission for this module
    const hasModulePermission = hasPermission(userRole, requestedResource, requestedPermission);
    
    if (!hasModulePermission) {
      return {
        canAccess: false,
        scope: 'none',
        filters: {}
      };
    }
    
    // Get the access scope for this role and module
    const accessScope = getAccessScope(userRole, requestedResource);
    
    const result: FilterResult = {
      canAccess: true,
      scope: accessScope,
      filters: {}
    };
    
    // Apply filters based on access scope
    switch (accessScope) {
      case 'self':
        result.filters.employeeId = userId;
        break;
        
      case 'team':
        // For team scope, filter by department for now
        // In a real system, this would be based on team hierarchy
        if (userDepartment) {
          result.filters.department = userDepartment;
        } else {
          result.filters.employeeId = userId; // Fallback to self if no department
        }
        break;
        
      case 'department':
        if (userDepartment) {
          result.filters.department = userDepartment;
        }
        break;
        
      case 'event_staff':
        result.filters.eventStaffOnly = true;
        break;
        
      case 'all':
        // No filters - can access all data
        break;
        
      case 'none':
        result.canAccess = false;
        break;
    }
    
    return result;
  }
  
  /**
   * Applies employee data filters based on user permissions
   */
  static applyEmployeeFilters(baseQuery: any, filter: FilterResult) {
    if (!filter.canAccess) {
      // Return empty result set
      return baseQuery.where('1 = 0');
    }
    
    let query = baseQuery;
    
    if (filter.filters.employeeId) {
      query = query.where('employees.id = ?', filter.filters.employeeId);
    }
    
    if (filter.filters.department) {
      query = query.where('employees.department = ?', filter.filters.department);
    }
    
    if (filter.filters.eventStaffOnly) {
      query = query.where('employees.employee_type = ?', 'temporary');
    }
    
    return query;
  }
  
  /**
   * Applies payroll data filters based on user permissions
   */
  static applyPayrollFilters(baseQuery: any, filter: FilterResult) {
    if (!filter.canAccess) {
      return baseQuery.where('1 = 0');
    }
    
    let query = baseQuery;
    
    if (filter.filters.employeeId) {
      query = query.where('payroll.employee_id = ?', filter.filters.employeeId);
    }
    
    if (filter.filters.department) {
      query = query.join('employees', 'payroll.employee_id', 'employees.id')
                   .where('employees.department = ?', filter.filters.department);
    }
    
    return query;
  }
  
  /**
   * Applies attendance data filters based on user permissions
   */
  static applyAttendanceFilters(baseQuery: any, filter: FilterResult) {
    if (!filter.canAccess) {
      return baseQuery.where('1 = 0');
    }
    
    let query = baseQuery;
    
    if (filter.filters.employeeId) {
      query = query.where('attendance.employee_id = ?', filter.filters.employeeId);
    }
    
    if (filter.filters.department) {
      query = query.join('employees', 'attendance.employee_id', 'employees.id')
                   .where('employees.department = ?', filter.filters.department);
    }
    
    return query;
  }
  
  /**
   * Applies leave data filters based on user permissions
   */
  static applyLeaveFilters(baseQuery: any, filter: FilterResult) {
    if (!filter.canAccess) {
      return baseQuery.where('1 = 0');
    }
    
    let query = baseQuery;
    
    if (filter.filters.employeeId) {
      query = query.where('leaves.employee_id = ?', filter.filters.employeeId);
    }
    
    if (filter.filters.department) {
      query = query.join('employees', 'leaves.employee_id', 'employees.id')
                   .where('employees.department = ?', filter.filters.department);
    }
    
    return query;
  }
}

/**
 * Express middleware to add data filtering to requests
 */
export function addDataFiltering(module: HRModule, permission: Permission = 'read') {
  return (req: Request & { dataFilter?: FilterResult }, res: any, next: any) => {
    const user = req.user as any;
    
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const filterOptions: DataFilterOptions = {
      userId: user.userId || user.id,
      userRole: user.role,
      userDepartment: user.department,
      requestedResource: module,
      requestedPermission: permission
    };
    
    req.dataFilter = DataFilterService.getDataFilter(filterOptions);
    
    if (!req.dataFilter.canAccess) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: `You do not have ${permission} permission for ${module}` 
      });
    }
    
    next();
  };
}