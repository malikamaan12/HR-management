import express from "express";
import {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getAllPermissions,
  getPermissionById,
  getPermissionsByModule,
  createPermission,
  updatePermission,
  deletePermission,
  assignPermissionToRole,
  removePermissionFromRole,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  logSecurityEvent,
  getSecurityLogs,
  checkUserHasPermission,
  getUserPermissions
} from "../services/roleManagement";
import { authenticate, authorize } from "../middleware/auth";
import { 
  insertRoleSchema, 
  insertPermissionSchema, 
  securityEventTypeEnum
} from "@shared/schema";

const router = express.Router();

// Middleware to check if the user has admin role
// This is different from authorize(['admin']) which checks for admin/hr_manager roles
const requireAdminRole = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const hasPermission = await checkUserHasPermission(userId, "manage_roles_permissions");
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
    }

    next();
  } catch (error) {
    console.error("Error in requireAdminRole middleware:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Log security event middleware
const logSecurityAction = (eventType: typeof securityEventTypeEnum.enumValues[number], description: string) => {
  return async (req: any, res: any, next: any) => {
    try {
      const userId = req.user?.userId;
      const userAgent = req.headers["user-agent"];
      const ipAddress = req.ip || req.headers["x-forwarded-for"] || "";
      const resourceType = req.originalUrl;
      
      // Create security log entry
      await logSecurityEvent({
        eventType,
        userId,
        description,
        ipAddress: ipAddress as string,
        userAgent: userAgent as string,
        resourceType,
        severity: "info"
      });
      
      next();
    } catch (error) {
      console.error("Error logging security event:", error);
      next(); // Continue even if logging fails
    }
  };
};

// Role routes
router.get("/roles", authenticate, async (req, res) => {
  try {
    const roles = await getAllRoles();
    res.json({ success: true, data: roles });
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({ success: false, message: "Failed to fetch roles" });
  }
});

router.get("/roles/:id", authenticate, async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const role = await getRoleById(roleId);
    
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }
    
    res.json({ success: true, data: role });
  } catch (error) {
    console.error("Error fetching role:", error);
    res.status(500).json({ success: false, message: "Failed to fetch role" });
  }
});

router.post(
  "/roles", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Role created"),
  async (req, res) => {
    try {
      const validatedData = insertRoleSchema.safeParse(req.body);
      
      if (!validatedData.success) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid role data", 
          errors: validatedData.error.errors 
        });
      }
      
      const role = await createRole(validatedData.data);
      res.status(201).json({ success: true, data: role });
    } catch (error) {
      console.error("Error creating role:", error);
      res.status(500).json({ success: false, message: "Failed to create role" });
    }
  }
);

router.put(
  "/roles/:id", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Role updated"),
  async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      const validatedData = insertRoleSchema.partial().safeParse(req.body);
      
      if (!validatedData.success) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid role data", 
          errors: validatedData.error.errors 
        });
      }
      
      const role = await updateRole(roleId, validatedData.data);
      
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }
      
      res.json({ success: true, data: role });
    } catch (error) {
      console.error("Error updating role:", error);
      res.status(500).json({ success: false, message: "Failed to update role" });
    }
  }
);

router.delete(
  "/roles/:id", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Role deleted"),
  async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      const role = await deleteRole(roleId);
      
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }
      
      res.json({ success: true, data: role });
    } catch (error) {
      console.error("Error deleting role:", error);
      res.status(500).json({ success: false, message: "Failed to delete role" });
    }
  }
);

// Permission routes
router.get("/permissions", authenticate, async (req, res) => {
  try {
    const { module } = req.query;
    
    let permissions;
    if (module && typeof module === 'string') {
      permissions = await getPermissionsByModule(module);
    } else {
      permissions = await getAllPermissions();
    }
    
    res.json({ success: true, data: permissions });
  } catch (error) {
    console.error("Error fetching permissions:", error);
    res.status(500).json({ success: false, message: "Failed to fetch permissions" });
  }
});

router.get("/permissions/:id", authenticate, async (req, res) => {
  try {
    const permissionId = parseInt(req.params.id);
    const permission = await getPermissionById(permissionId);
    
    if (!permission) {
      return res.status(404).json({ success: false, message: "Permission not found" });
    }
    
    res.json({ success: true, data: permission });
  } catch (error) {
    console.error("Error fetching permission:", error);
    res.status(500).json({ success: false, message: "Failed to fetch permission" });
  }
});

router.post(
  "/permissions", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Permission created"),
  async (req, res) => {
    try {
      const validatedData = insertPermissionSchema.safeParse(req.body);
      
      if (!validatedData.success) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid permission data", 
          errors: validatedData.error.errors 
        });
      }
      
      const permission = await createPermission(validatedData.data);
      res.status(201).json({ success: true, data: permission });
    } catch (error) {
      console.error("Error creating permission:", error);
      res.status(500).json({ success: false, message: "Failed to create permission" });
    }
  }
);

router.put(
  "/permissions/:id", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Permission updated"),
  async (req, res) => {
    try {
      const permissionId = parseInt(req.params.id);
      const validatedData = insertPermissionSchema.partial().safeParse(req.body);
      
      if (!validatedData.success) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid permission data", 
          errors: validatedData.error.errors 
        });
      }
      
      const permission = await updatePermission(permissionId, validatedData.data);
      
      if (!permission) {
        return res.status(404).json({ success: false, message: "Permission not found" });
      }
      
      res.json({ success: true, data: permission });
    } catch (error) {
      console.error("Error updating permission:", error);
      res.status(500).json({ success: false, message: "Failed to update permission" });
    }
  }
);

router.delete(
  "/permissions/:id", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Permission deleted"),
  async (req, res) => {
    try {
      const permissionId = parseInt(req.params.id);
      const permission = await deletePermission(permissionId);
      
      if (!permission) {
        return res.status(404).json({ success: false, message: "Permission not found" });
      }
      
      res.json({ success: true, data: permission });
    } catch (error) {
      console.error("Error deleting permission:", error);
      res.status(500).json({ success: false, message: "Failed to delete permission" });
    }
  }
);

// Role-Permission assignment routes
router.post(
  "/roles/:roleId/permissions/:permissionId", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Permission assigned to role"),
  async (req, res) => {
    try {
      const roleId = parseInt(req.params.roleId);
      const permissionId = parseInt(req.params.permissionId);
      
      const assignment = await assignPermissionToRole(roleId, permissionId);
      res.status(201).json({ success: true, data: assignment });
    } catch (error) {
      console.error("Error assigning permission to role:", error);
      res.status(500).json({ success: false, message: "Failed to assign permission to role" });
    }
  }
);

router.delete(
  "/roles/:roleId/permissions/:permissionId", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("permission_change", "Permission removed from role"),
  async (req, res) => {
    try {
      const roleId = parseInt(req.params.roleId);
      const permissionId = parseInt(req.params.permissionId);
      
      const assignment = await removePermissionFromRole(roleId, permissionId);
      
      if (!assignment) {
        return res.status(404).json({ success: false, message: "Role-permission assignment not found" });
      }
      
      res.json({ success: true, data: assignment });
    } catch (error) {
      console.error("Error removing permission from role:", error);
      res.status(500).json({ success: false, message: "Failed to remove permission from role" });
    }
  }
);

// User-Role assignment routes
router.get("/users/:userId/roles", authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    // Only allow users to view their own roles unless they have admin permission
    if (req.user!.userId !== userId) {
      const hasPermission = await checkUserHasPermission(req.user!.userId, "manage_roles_permissions");
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }
    
    const roles = await getUserRoles(userId);
    res.json({ success: true, data: roles });
  } catch (error) {
    console.error("Error fetching user roles:", error);
    res.status(500).json({ success: false, message: "Failed to fetch user roles" });
  }
});

router.post(
  "/users/:userId/roles/:roleId", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("role_assignment", "Role assigned to user"),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const roleId = parseInt(req.params.roleId);
      const assignedBy = req.user!.userId;
      
      const assignment = await assignRoleToUser(userId, roleId, assignedBy);
      res.status(201).json({ success: true, data: assignment });
    } catch (error) {
      console.error("Error assigning role to user:", error);
      res.status(500).json({ success: false, message: "Failed to assign role to user" });
    }
  }
);

router.delete(
  "/users/:userId/roles/:roleId", 
  authenticate, 
  requireAdminRole,
  logSecurityAction("role_assignment", "Role removed from user"),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const roleId = parseInt(req.params.roleId);
      
      const assignment = await removeRoleFromUser(userId, roleId);
      
      if (!assignment) {
        return res.status(404).json({ success: false, message: "User-role assignment not found" });
      }
      
      res.json({ success: true, data: assignment });
    } catch (error) {
      console.error("Error removing role from user:", error);
      res.status(500).json({ success: false, message: "Failed to remove role from user" });
    }
  }
);

// User permissions route
router.get("/users/:userId/permissions", authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    // Only allow users to view their own permissions unless they have admin permission
    if (req.user!.userId !== userId) {
      const hasPermission = await checkUserHasPermission(req.user!.userId, "manage_roles_permissions");
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }
    
    const permissions = await getUserPermissions(userId);
    res.json({ success: true, data: permissions });
  } catch (error) {
    console.error("Error fetching user permissions:", error);
    res.status(500).json({ success: false, message: "Failed to fetch user permissions" });
  }
});

// Security logs routes
router.get(
  "/security-logs", 
  authenticate, 
  requireAdminRole, 
  async (req, res) => {
    try {
      const { 
        userId, 
        eventType, 
        startDate, 
        endDate, 
        severity, 
        limit, 
        offset 
      } = req.query;
      
      const filters: any = {};
      
      if (userId && !isNaN(Number(userId))) {
        filters.userId = parseInt(userId as string);
      }
      
      if (eventType && typeof eventType === 'string') {
        filters.eventType = eventType;
      }
      
      if (startDate && !isNaN(Date.parse(startDate as string))) {
        filters.startDate = new Date(startDate as string);
      }
      
      if (endDate && !isNaN(Date.parse(endDate as string))) {
        filters.endDate = new Date(endDate as string);
      }
      
      if (severity && typeof severity === 'string') {
        filters.severity = severity;
      }
      
      if (limit && !isNaN(Number(limit))) {
        filters.limit = parseInt(limit as string);
      }
      
      if (offset && !isNaN(Number(offset))) {
        filters.offset = parseInt(offset as string);
      }
      
      const logs = await getSecurityLogs(filters);
      res.json({ success: true, data: logs });
    } catch (error) {
      console.error("Error fetching security logs:", error);
      res.status(500).json({ success: false, message: "Failed to fetch security logs" });
    }
  }
);

export default router;