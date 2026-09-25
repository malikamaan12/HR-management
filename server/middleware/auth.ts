import { Request, Response, NextFunction } from "express";
import { authService, TokenPayload } from "../services/auth";

// Extend Express Request to include user information
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      token?: string;
    }
  }
}

/**
 * Middleware to authenticate JWT tokens from request
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // In development mode, still process real tokens if present
    // Every request requires a current server session.
    let token: string | undefined;
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required" 
      });
    }
    
    // Verify and decode token
    const decodedToken = await authService.authenticateToken(token);
    const route=req.originalUrl.split('?')[0];
    if(decodedToken.mfaRequired&&!/^\/api\/auth\/(mfa(?:\/|$)|me$|logout$)/.test(route))return res.status(403).json({message:'Set up multifactor authentication before using this account.',code:'MFA_ENROLLMENT_REQUIRED'});
    
    // Attach user to request
    req.user = decodedToken;
    req.token = token;
    
    return next();
  } catch (error) {
    console.error("Authentication failed");
    return res.status(401).json({ 
      success: false, 
      message: "Invalid or expired token" 
    });
  }
};

/**
 * Middleware to check user role
 * @param roles Array of allowed roles for the route
 */
export const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource"
      });
    }
    
    next();
  };
};

/**
 * Middleware to check if user is acting on their own resources
 * Useful for routes where users should only access their own data
 */
export const checkSelfOrHigherRole = (paramIdField: string = "id") => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }
    
    // Get the ID from the route parameter
    const resourceId = parseInt(req.params[paramIdField], 10);
    
    // Check if the user is accessing their own resource or has higher role privileges
    const isAdmin = req.user.role === "admin";
    const isHR = req.user.role === "hr";
    const isManager = req.user.role === "manager" || req.user.role === "department_head";
    const isSelf = req.user.userId === resourceId;
    
    if (isSelf || isAdmin || isHR || isManager) {
      next();
    } else {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource"
      });
    }
  };
};

/**
 * Middleware to log API access
 */
export const logApiAccess = (req: Request, _res: Response, next: NextFunction) => {
  const userId = req.user?.userId;
  const path = req.path;
  const method = req.method;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"] || "";
  
  if (userId) {
    // We don't need to await this, it can run in the background
    authService["logSecurityEvent"]({
      eventType: "api_access",
      userId,
      description: `API access: ${method} ${path}`,
      ipAddress,
      userAgent,
      resourceType: "api",
      resourceId: path,
      severity: "info"
    }).catch(err => console.error("Error logging API access:", err));
  }
  
  next();
};
