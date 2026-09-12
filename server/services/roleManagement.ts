import { db } from "../db";
import { 
  roles, 
  permissions, 
  rolePermissions, 
  userRoles,
  securityLogs,
  securityEventTypeEnum,
  type InsertRole,
  type InsertPermission,
  type InsertRolePermission,
  type InsertUserRole,
  type InsertSecurityLog
} from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";

// Role Management
export async function getAllRoles() {
  return await db.query.roles.findMany({
    with: {
      permissions: {
        with: {
          permission: true
        }
      },
      users: {
        with: {
          user: true
        }
      }
    }
  });
}

export async function getRoleById(id: number) {
  return await db.query.roles.findFirst({
    where: eq(roles.id, id),
    with: {
      permissions: {
        with: {
          permission: true
        }
      },
      users: {
        with: {
          user: true
        }
      }
    }
  });
}

export async function createRole(role: InsertRole) {
  const [newRole] = await db.insert(roles).values(role).returning();
  return newRole;
}

export async function updateRole(id: number, role: Partial<InsertRole>) {
  const [updatedRole] = await db
    .update(roles)
    .set({ ...role, updatedAt: new Date() })
    .where(eq(roles.id, id))
    .returning();
  return updatedRole;
}

export async function deleteRole(id: number) {
  // First delete all role permissions
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
  // Then delete all user role assignments
  await db.delete(userRoles).where(eq(userRoles.roleId, id));
  // Finally delete the role
  const [deletedRole] = await db.delete(roles).where(eq(roles.id, id)).returning();
  return deletedRole;
}

// Permission Management
export async function getAllPermissions() {
  return await db.query.permissions.findMany({
    with: {
      roles: {
        with: {
          role: true
        }
      }
    }
  });
}

export async function getPermissionById(id: number) {
  return await db.query.permissions.findFirst({
    where: eq(permissions.id, id),
    with: {
      roles: {
        with: {
          role: true
        }
      }
    }
  });
}

export async function getPermissionsByModule(module: string) {
  return await db.query.permissions.findMany({
    where: eq(permissions.module, module),
    with: {
      roles: {
        with: {
          role: true
        }
      }
    }
  });
}

export async function createPermission(permission: InsertPermission) {
  const [newPermission] = await db.insert(permissions).values(permission).returning();
  return newPermission;
}

export async function updatePermission(id: number, permission: Partial<InsertPermission>) {
  const [updatedPermission] = await db
    .update(permissions)
    .set({ ...permission, updatedAt: new Date() })
    .where(eq(permissions.id, id))
    .returning();
  return updatedPermission;
}

export async function deletePermission(id: number) {
  // First delete all role permissions
  await db.delete(rolePermissions).where(eq(rolePermissions.permissionId, id));
  // Then delete the permission
  const [deletedPermission] = await db.delete(permissions).where(eq(permissions.id, id)).returning();
  return deletedPermission;
}

// Role-Permission Assignment
export async function assignPermissionToRole(roleId: number, permissionId: number) {
  // Check if assignment already exists
  const existing = await db.query.rolePermissions.findFirst({
    where: and(
      eq(rolePermissions.roleId, roleId),
      eq(rolePermissions.permissionId, permissionId)
    )
  });

  if (existing) {
    return existing; // Assignment already exists
  }

  const [newAssignment] = await db.insert(rolePermissions)
    .values({ roleId, permissionId })
    .returning();
  
  return newAssignment;
}

export async function removePermissionFromRole(roleId: number, permissionId: number) {
  const [deletedAssignment] = await db.delete(rolePermissions)
    .where(and(
      eq(rolePermissions.roleId, roleId),
      eq(rolePermissions.permissionId, permissionId)
    ))
    .returning();
  
  return deletedAssignment;
}

// User-Role Assignment
export async function getUserRoles(userId: number) {
  return await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: {
      role: true,
      assignedByUser: true
    }
  });
}

export async function assignRoleToUser(userId: number, roleId: number, assignedBy: number) {
  // Check if assignment already exists
  const existing = await db.query.userRoles.findFirst({
    where: and(
      eq(userRoles.userId, userId),
      eq(userRoles.roleId, roleId)
    )
  });

  if (existing) {
    return existing; // Assignment already exists
  }

  const [newAssignment] = await db.insert(userRoles)
    .values({ userId, roleId, assignedBy })
    .returning();
  
  return newAssignment;
}

export async function removeRoleFromUser(userId: number, roleId: number) {
  const [deletedAssignment] = await db.delete(userRoles)
    .where(and(
      eq(userRoles.userId, userId),
      eq(userRoles.roleId, roleId)
    ))
    .returning();
  
  return deletedAssignment;
}

// Security Logging
export async function logSecurityEvent(logEntry: InsertSecurityLog) {
  const [newLog] = await db.insert(securityLogs)
    .values(logEntry)
    .returning();
  
  return newLog;
}

export async function getSecurityLogs(filters: {
  userId?: number;
  eventType?: typeof securityEventTypeEnum.enumValues[number];
  startDate?: Date;
  endDate?: Date;
  severity?: string;
  limit?: number;
  offset?: number;
}) {
  const { userId, eventType, startDate, endDate, severity, limit = 100, offset = 0 } = filters;
  
  let query = db.select().from(securityLogs).$dynamic();
  
  // Apply filters
  const conditions = [];
  
  if (userId) {
    conditions.push(eq(securityLogs.userId, userId));
  }
  
  if (eventType) {
    conditions.push(eq(securityLogs.eventType, eventType));
  }
  
  if (severity) {
    conditions.push(eq(securityLogs.severity, severity));
  }
  
  if (startDate) {
    conditions.push(sql`${securityLogs.timestamp} >= ${startDate}`);
  }
  
  if (endDate) {
    conditions.push(sql`${securityLogs.timestamp} <= ${endDate}`);
  }
  
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  
  // Apply pagination
  query = query.limit(limit).offset(offset).orderBy(sql`${securityLogs.timestamp} DESC`);
  
  return await query;
}

// Permission checking utilities
export async function checkUserHasPermission(userId: number, permissionName: string) {
  // Get all roles assigned to the user
  const userRolesList = await getUserRoles(userId);
  
  if (userRolesList.length === 0) {
    return false;
  }
  
  const roleIds = userRolesList.map(ur => ur.roleId);
  
  // Find the permission
  const permission = await db.query.permissions.findFirst({
    where: eq(permissions.name, permissionName)
  });
  
  if (!permission) {
    return false;
  }
  
  // Check if any of the user's roles has this permission
  const rolePermission = await db.query.rolePermissions.findFirst({
    where: and(
      eq(rolePermissions.permissionId, permission.id),
      sql`${rolePermissions.roleId} IN (${roleIds.join(',')})`
    )
  });
  
  return !!rolePermission;
}

export async function getUserPermissions(userId: number) {
  // Get all roles assigned to the user
  const userRolesList = await getUserRoles(userId);
  
  if (userRolesList.length === 0) {
    return [];
  }
  
  const roleIds = userRolesList.map(ur => ur.roleId);
  
  // Get all permission IDs assigned to these roles
  const rolePermissionsList = await db.query.rolePermissions.findMany({
    where: sql`${rolePermissions.roleId} IN (${roleIds.join(',')})`,
    with: {
      permission: true
    }
  });
  
  // Create a unique set of permissions
  const uniquePermissions = new Map();
  rolePermissionsList.forEach(rp => {
    if (rp.permission) {
      uniquePermissions.set(rp.permission.id, rp.permission);
    }
  });
  
  return Array.from(uniquePermissions.values());
}