import express from "express";
import { rateLimit } from 'express-rate-limit';
import { authService } from "../services/auth";
import { insertUserSchema } from "@shared/schema";
import { authenticate, authorize } from "../middleware/auth";
import { body, validationResult } from "express-validator";
import { z } from "zod";
import { db } from "../db";
import { users, employees, userRoleEnum } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";


const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' } });
router.use(['/login','/signup','/register','/forgot-password','/reset-password'], authLimiter);
const signupSchema = z.object({
  username: z.string().trim().min(3).max(100), password: z.string().min(8).max(72)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/),
  email: z.string().trim().email().max(254), firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100), qidNumber: z.string().regex(/^\d{11}$/),
  department: z.string().trim().min(1).max(100), employeeType: z.enum(['permanent','temporary','contract']),
});
// Cookies are sent only to this application; no browser cross-origin writes.
router.use((req, res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin) {
    const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : req.protocol + '://' + req.get('host');
    if (req.headers.origin !== expected) return res.status(403).json({ message: 'Cross-origin request denied' });
  }
  next();
});

/**
 * Register a new user
 * POST /api/auth/register
 */
router.post("/register", async (req: express.Request, res: express.Response) => {
  try {
    // Validate the request data with Zod schema
    const validationResult = insertUserSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        errors: validationResult.error.errors
      });
    }
    
    // Extract user data (excluding confirmPassword)
    const { confirmPassword, ...userData } = validationResult.data;
    
    // Check if username already exists
    const existingUser = await authService.findUserByUsername(userData.username);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Username already exists"
      });
    }
    
    // Check if email already exists
    const existingEmail = await authService.findUserByEmail(userData.email);
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already exists"
      });
    }
    
    // Add IP and user agent
    const userDataWithMetadata = {
      ...userData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    };
    
    // Create new user
    const newUser = await authService.registerUser(userDataWithMetadata);
    
    res.status(201).json({
      success: true,
      message: "User registered successfully, pending approval",
      user: newUser
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
});

/**
 * Signup endpoint for new employees
 * POST /api/auth/signup
 */
router.post("/signup", async (req: express.Request, res: express.Response) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors });
  try {
    const {
      username,
      password,
      email,
      firstName,
      lastName,
      qidNumber,
      department,
      employeeType,
    } = parsed.data;
    
    // Determine the correct role based on employee type and position
    const role = employeeType === 'temporary' ? 'temporary_staff' : 'permanent_employee';
    
    // Check if username already exists
    const [existingUser] = await db.select().from(users).where(eq(users.username, username));
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Username already exists"
      });
    }
    
    // Check if email already exists
    const [existingEmail] = await db.select().from(users).where(eq(users.email, email));
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already exists"
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user account
    const [newUser] = await db.insert(users).values({
      username,
      password: hashedPassword,
      email,
      firstName,
      lastName,
      role,
      department,
      qidNumber,
      isActive: false, // Requires admin approval
      isEmailVerified: false,
      approvalStatus: 'pending',
    }).returning();
    
    // Generate employee ID based on type for future use
    const employeeIdPrefix = employeeType === 'permanent' ? 'EMP' : 
                            employeeType === 'temporary' ? 'TMP' : 'CON';
    const employeeId = `${employeeIdPrefix}${Date.now().toString().slice(-6)}`;
    
    // TODO: Employee record creation will be handled by HR after approval
    // For now, just create the user account
    
    res.status(201).json({
      success: true,
      message: "Account created successfully. HR will complete your employee profile after approval.",
      userId: newUser.id,
      employeeId: employeeId,
      employeeType: employeeType
    });
    
  } catch (error: any) {
    console.error("Signup error:", error);
    
    // Handle specific database constraint errors
    if (error?.code === '23505') {
      if (error?.constraint === 'users_username_unique') {
        return res.status(400).json({
          success: false,
          message: "Username already exists"
        });
      }
      if (error?.constraint === 'users_email_unique') {
        return res.status(400).json({
          success: false,
          message: "Email already exists"
        });
      }
      if (error?.constraint === 'users_qid_number_key') {
        return res.status(400).json({
          success: false,
          message: "QID number already exists"
        });
      }
      
      // Generic duplicate key error for any other constraint
      return res.status(400).json({
        success: false,
        message: "This information is already in use"
      });
    }
    
    res.status(500).json({
      success: false,
      message: "Failed to create account"
    });
  }
});

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
    const sessions = await authService.getUserSessions(userId);
    
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
