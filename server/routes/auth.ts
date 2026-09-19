import express from "express";
import { rateLimit } from 'express-rate-limit';
import { authService } from "../services/auth";
import { authenticate, authorize } from "../middleware/auth";
import { body, validationResult } from "express-validator";
import { z } from "zod";
import { db } from "../db";
import { users, employees, userRoleEnum } from "@shared/schema";
import { eq } from "drizzle-orm";


const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' } });
router.use(['/login','/signup','/register','/forgot-password','/reset-password'], authLimiter);
// Cookies are sent only to this application; no browser cross-origin writes.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin) {
    const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : req.protocol + '://' + req.get('host');
    if (req.headers.origin !== expected) return res.status(403).json({ message: 'Cross-origin request denied' });
  }
  next();
});

// Employee accounts are provisioned by administrators, never through public registration.
router.post(['/register','/signup'], (_req,res) => res.status(403).json({success:false,message:'Self-registration is disabled. Contact HR for an administrator-created account.'}));

/**
 * Login user
 * POST /api/auth/login
 */
router.post("/login", [
  body("username").notEmpty().withMessage("Username is required"),
  body("password").notEmpty().withMessage("Password is required")
], async (req: express.Request, res: express.Response) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    
    const { username, password } = req.body;
    
    // Authenticate user
    const auth = await authService.login(
      username, 
      password, 
      req.ip, 
      req.headers["user-agent"]
    );
    
    // Set tokens in cookies (httpOnly for security)
    res.cookie("accessToken", auth.accessToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000 // 15 minutes
    });
    
    res.cookie("refreshToken", auth.refreshToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth", // Only sent with refresh token requests
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.json({
      success: true,
      message: "Login successful",
      user: auth.user,
      accessToken: auth.accessToken, // Include for non-cookie clients
      refreshToken: auth.refreshToken // Include for non-cookie clients
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(401).json({
      success: false,
      message: (error instanceof Error ? error.message : "Login failed")
    });
  }
});

/**
 * Logout user
 * POST /api/auth/logout
 */
router.post('/logout', async (req: express.Request, res: express.Response) => {
  try {
    await authService.logoutSession(req.cookies?.refreshToken || req.body.refreshToken);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.clearCookie('refreshToken', { path: '/api/auth/refresh-token' });
    res.json({ success: true, message: 'Logout successful' });
  } catch { res.status(500).json({ message: 'Logout failed' }); }
});

/**
 * Refresh access token
 * POST /api/auth/refresh-token
 */
router.post("/refresh-token", async (req: express.Request, res: express.Response) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required"
      });
    }
    
    // Refresh token
    const auth = await authService.refreshToken(
      refreshToken, 
      req.ip, 
      req.headers["user-agent"]
    );
    
    // Set new tokens in cookies
    res.cookie("accessToken", auth.accessToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000 // 15 minutes
    });
    
    res.cookie("refreshToken", auth.refreshToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.json({
      success: true,
      message: "Token refreshed",
      user: auth.user,
      accessToken: auth.accessToken, // Include for non-cookie clients
      refreshToken: auth.refreshToken  // Include for non-cookie clients
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token"
    });
  }
});

/**
 * Request password reset
 * POST /api/auth/forgot-password
 */
router.post("/forgot-password", [
  body("email").isEmail().withMessage("Valid email is required")
], async (req: express.Request, res: express.Response) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    
    const { email } = req.body;
    
    // Request password reset
    const result = await authService.requestPasswordReset(
      email, 
      req.ip, 
      req.headers["user-agent"]
    );
    
    res.json(result);
  } catch (error) {
    console.error("Password reset request error:", error);
    res.status(500).json({
      success: false,
      message: "Password reset request failed"
    });
  }
});

/**
 * Reset password with token
 * POST /api/auth/reset-password
 */
router.post("/reset-password", [
  body("token").notEmpty().withMessage("Reset token is required"),
  body("newPassword")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
    .withMessage("Password must include uppercase, lowercase, number, and special character"),
  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error("Passwords do not match");
    }
    return true;
  })
], async (req: express.Request, res: express.Response) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    
    const { token, newPassword } = req.body;
    
    // Reset password
    const result = await authService.resetPassword(
      token, 
      newPassword, 
      req.ip, 
      req.headers["user-agent"]
    );
    
    res.json(result);
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(400).json({
      success: false,
      message: (error instanceof Error ? error.message : "Password reset failed")
    });
  }
});

/**
 * Change password (when logged in)
 * POST /api/auth/change-password
 */
router.post("/change-password", authenticate, [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
    .withMessage("Password must include uppercase, lowercase, number, and special character"),
  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error("Passwords do not match");
    }
    return true;
  })
], async (req: express.Request, res: express.Response) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    
    const { currentPassword, newPassword } = req.body;
    
    // Change password
    const result = await authService.changePassword(
      req.user!.userId,
      currentPassword, 
      newPassword,
      req.ip,
      req.headers["user-agent"]
    );
    
    res.json(result);
  } catch (error) {
    console.error("Password change error:", error);
    res.status(400).json({
      success: false,
      message: (error instanceof Error ? error.message : "Password change failed")
    });
  }
});

/**
 * Get current user info
 * GET /api/auth/me
 */
router.get("/me", authenticate, async (req: express.Request, res: express.Response) => {
  try {
    const user = await authService.getUserById(req.user!.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user information"
    });
  }
});

/**
 * Get pending users for approval (Admin only)
 * GET /api/auth/pending-users
 */
router.get("/pending-users", authenticate, authorize(["super_admin", "admin", "hr_director", "hr"]), async (req: express.Request, res: express.Response) => {
  try {
    const pendingUsers = await authService.getPendingUsers();
    
    res.json({
      success: true,
      users: pendingUsers
    });
  } catch (error) {
    console.error("Get pending users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get pending users"
    });
  }
});

/**
 * Approve user (Admin only)
 * POST /api/auth/approve-user/:id
 */
router.post("/approve-user/:id", authenticate, authorize(["super_admin", "admin"]), async (req: express.Request, res: express.Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    // Approve user
    const result = await authService.approveUserAccount(userId, req.user!.userId);
    
    res.json(result);
  } catch (error) {
    console.error("User approval error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve user"
    });
  }
});

/**
 * Update user role (Admin only)
 * PUT /api/auth/update-role/:id
 */
router.put("/update-role/:id", authenticate, authorize(["super_admin", "admin"]), [
  body("role").isIn(userRoleEnum.enumValues)
    .withMessage("Invalid role")
], async (req: express.Request, res: express.Response) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    
    const userId = parseInt(req.params.id, 10);
    const { role } = req.body;
    
    // Update role
    const result = await authService.updateUserRole(userId, role, req.user!.userId);
    
    res.json(result);
  } catch (error) {
    console.error("Role update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user role"
    });
  }
});

/**
 * Get user active sessions (for self or admin)
 * GET /api/auth/sessions/:userId
 */
router.get("/sessions/:userId", authenticate, async (req: express.Request, res: express.Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    
    // Check permissions - only self or admin can view sessions
    if (req.user!.userId !== userId && !(["admin", "super_admin"].includes(req.user!.role))) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view these sessions"
      });
    }
    
    // Get sessions
    const sessions = await authService.getUserSessions(userId, req.user!.userId === userId ? req.cookies?.refreshToken : undefined);
    
    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user sessions"
    });
  }
});

/**
 * Revoke session (for self or admin)
 * POST /api/auth/revoke-session/:sessionId
 */
router.post("/revoke-session/:sessionId", authenticate, async (req: express.Request, res: express.Response) => {
  try {
    const sessionId = parseInt(req.params.sessionId, 10);
    
    // Revoke session
    const result = await authService.revokeSession(sessionId, req.user!.userId);
    
    res.json(result);
  } catch (error) {
    console.error("Revoke session error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to revoke session"
    });
  }
});

/**
 * Update user profile
 * PUT /api/auth/profile
 */
router.put("/profile", authenticate, async (req: express.Request, res: express.Response) => {
  try {
    const input=z.object({firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().min(1).max(100)}).safeParse(req.body);
    if(!input.success)return res.status(400).json({message:'First and last names are required'});
    const updateData=input.data;
    // Update user
    await db.update(users)
      .set(updateData)
      .where(eq(users.id, req.user!.userId));
    
    // Get updated user
    const updatedUser = await authService.getUserById(req.user!.userId);
    
    res.json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile"
    });
  }
});

/**
 * Update QID number
 * PUT /api/auth/qid
 */
router.put("/qid", authenticate, authorize(["admin", "super_admin"]), [
  body("qidNumber").notEmpty().withMessage("QID number is required")
], async (req: express.Request, res: express.Response) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    
    const { qidNumber } = req.body;
    
    // Check if QID is already in use
    const [existingUser] = await db.select()
      .from(users)
      .where(eq(users.qidNumber, qidNumber));
    
    if (existingUser && existingUser.id !== req.user!.userId) {
      return res.status(400).json({
        success: false,
        message: "QID number is already in use"
      });
    }
    
    // Update QID
    await db.update(users)
      .set({ qidNumber })
      .where(eq(users.id, req.user!.userId));
    
    res.json({
      success: true,
      message: "QID number updated successfully"
    });
  } catch (error) {
    console.error("QID update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update QID number"
    });
  }
});

export default router;
