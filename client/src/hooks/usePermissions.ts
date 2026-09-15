import React from 'react';
import { useAuth } from "@/contexts/AuthContext";
import { 
  hasPermission, 
  getAccessScope, 
  canAccessModule, 
  getAccessibleModules,
  canAccessData,
  type Permission, 
  type HRModule, 
  type AccessScope
} from "@shared/permissions";
import type { UserRole } from "@shared/schema";

/**
 * Custom hook for checking user permissions across HR modules
 * Provides comprehensive access control based on the role-based permission matrix
 */
export function usePermissions() {
  const { user } = useAuth();
  
  const userRole = user?.role as UserRole || 'employee';
  const userId = user?.userId?.toString();
  const userDepartment = user?.department;

  return {
    // Check if user has specific permission for a module
    hasPermission: (module: HRModule, permission: Permission) => 
      hasPermission(userRole, module, permission),

    // Check if user can access a module at all
    canAccessModule: (module: HRModule) => 
      canAccessModule(userRole, module),

    // Get user's access scope for a module
    getAccessScope: (module: HRModule) => 
      getAccessScope(userRole, module),

    // Get all modules user can access
    getAccessibleModules: () => 
      getAccessibleModules(userRole),

    // Check if user can access specific data based on scope
    canAccessData: (
      module: HRModule, 
      dataScope: 'own' | 'team' | 'department' | 'all',
      targetUserId?: string,
      targetDepartment?: string
    ) => canAccessData(
      userRole, 
      module, 
      dataScope, 
      userId, 
      targetUserId, 
      userDepartment, 
      targetDepartment
    ),

    // Convenience methods for common permission checks
    canCreate: (module: HRModule) => hasPermission(userRole, module, 'create'),
    canRead: (module: HRModule) => hasPermission(userRole, module, 'read'),
    canUpdate: (module: HRModule) => hasPermission(userRole, module, 'update'),
    canDelete: (module: HRModule) => hasPermission(userRole, module, 'delete'),
    canApprove: (module: HRModule) => hasPermission(userRole, module, 'approve'),
    isAdmin: (module: HRModule) => hasPermission(userRole, module, 'admin'),

    // Role-specific checks
    isSuperAdmin: () => userRole === 'super_admin',
    isHRDirector: () => userRole === 'hr_director',
    isHRManager: () => userRole === 'hr_manager',
    isDepartmentHead: () => userRole === 'department_head',
    isEventManager: () => userRole === 'event_manager',
    isPermanentEmployee: () => userRole === 'permanent_employee',
    isTemporaryStaff: () => userRole === 'temporary_staff',
    
    // Legacy role checks for backwards compatibility
    isLegacyAdmin: () => userRole === 'admin',
    isLegacyHR: () => userRole === 'hr',
    isLegacyManager: () => userRole === 'manager',
    isLegacyEmployee: () => userRole === 'employee',

    // Data scope helpers
    canAccessAllData: (module: HRModule) => getAccessScope(userRole, module) === 'all',
    canAccessDepartmentData: (module: HRModule) => {
      const scope = getAccessScope(userRole, module);
      return scope === 'all' || scope === 'department';
    },
    canAccessTeamData: (module: HRModule) => {
      const scope = getAccessScope(userRole, module);
      return scope === 'all' || scope === 'department' || scope === 'team';
    },
    canAccessOwnDataOnly: (module: HRModule) => getAccessScope(userRole, module) === 'self',

    // Get user info for permission context
    userRole,
    userId,
    userDepartment,
  };
}

/**
 * HOC component for conditional rendering based on permissions
 */
interface PermissionGuardProps {
  module: HRModule;
  permission?: Permission;
  requireAll?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function PermissionGuard({ 
  module, 
  permission, 
  requireAll = false, 
  fallback = null, 
  children 
}: PermissionGuardProps) {
  const permissions = usePermissions();
  
  let hasAccess = permissions.canAccessModule(module);
  
  if (permission && hasAccess) {
    hasAccess = permissions.hasPermission(module, permission);
  }
  
  return hasAccess ? children : fallback;
}

/**
 * Component for rendering navigation items based on permissions
 */
interface NavigationItemProps {
  module: HRModule;
  requiredPermission?: Permission;
  children: React.ReactNode;
}

export function NavigationItem({ module, requiredPermission = 'read', children }: NavigationItemProps) {
  const permissions = usePermissions();
  
  if (!permissions.canAccessModule(module)) {
    return null;
  }
  
  if (!permissions.hasPermission(module, requiredPermission)) {
    return null;
  }
  
  return children;
}

/**
 * Hook for filtering data based on user's access scope
 */
export function useDataFilter() {
  const permissions = usePermissions();
  
  return {
    filterEmployeeData: <T extends { id?: number; department?: string; userId?: number; type?: string; reportingManagerId?: number | null }>(
      data: T[], 
      module: HRModule
    ): T[] => {
      const scope = permissions.getAccessScope(module);
      
      switch (scope) {
        case 'all':
          return data;
        case 'department':
          return data.filter(item => 
            item.department === permissions.userDepartment ||
            item.userId?.toString() === permissions.userId
          );
        case 'team':
          // Keep the employee and direct reports in the team view. The API
          // remains the source of truth; this is only a client-side guard.
          return data.filter(item => 
            item.userId?.toString() === permissions.userId ||
            item.reportingManagerId?.toString() === permissions.userId ||
            item.department === permissions.userDepartment
          );
        case 'self':
          return data.filter(item => 
            item.userId?.toString() === permissions.userId
          );
        case 'event_staff':
          return data.filter(item => item.type === 'temporary' || item.userId?.toString() === permissions.userId);
        case 'none':
        default:
          return [];
      }
    }
  };
}
