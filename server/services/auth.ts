import { db } from "../db";
import { eq, and, gt, sql } from "drizzle-orm";
import { users, authSessions, securityLogs, userRoleEnum, securityEventTypeEnum, type UserRole } from "@shared/schema";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { emailConfigured, sendPasswordResetEmail } from './email';

export function validateAuthConfiguration() {
  const access = process.env.JWT_SECRET;
  const refresh = process.env.JWT_REFRESH_SECRET;
  if (!access || !refresh || access.length < 32 || refresh.length < 32 || access === refresh) {
    throw new Error('Set different JWT_SECRET and JWT_REFRESH_SECRET values, each at least 32 characters');
  }
}
function secret(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
  validateAuthConfiguration();
  return process.env[name]!;
}
function safeUser(user: typeof users.$inferSelect) {
  const { password, refreshToken, passwordResetToken, passwordResetExpires, failedLoginAttempts, lockoutUntil, ...safe } = user;
  return safe;
}
function requireActive(user: typeof users.$inferSelect | null | undefined) {
  if (!user || !user.isActive || user.approvalStatus !== 'approved') throw new Error('Account is pending approval or inactive');
}
const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Secret key for JWT token signing - should be in environment variable

// Token expiration times
const ACCESS_TOKEN_EXPIRY = "15m"; // 15 minutes
const REFRESH_TOKEN_EXPIRY = "7d";  // 7 days

export interface TokenPayload {
  userId: number;
  username: string;
  role: UserRole;
  department?: string | null;
  employeeType?: string;
}

interface AuthResponse {
  user: any;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  async logoutSession(token?: string) {
    if (token) {
      await db.update(authSessions).set({ isActive: false }).where(eq(authSessions.refreshToken, token));
    }
    return { success: true, message: 'Logout successful' };
  }
  /**
   * Register a new user
   */
  async registerUser(userData: any) {
    try {
      // Hash the password before storing
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      
      // Create user with hashed password
      const newUser = await db.insert(users).values({
        username: userData.username, email: userData.email, firstName: userData.firstName, lastName: userData.lastName,
        department: userData.department || null, qidNumber: userData.qidNumber || null,
        role: userData.employeeType === 'temporary' ? 'temporary_staff' : 'permanent_employee',
        password: hashedPassword,
        isActive: false, // Requires admin approval
        approvalStatus: "pending",
      }).returning();
      
      // Log the security event
      await this.logSecurityEvent({
        eventType: "user_registration",
        userId: newUser[0].id,
        description: `New user registration: ${userData.username}`,
        ipAddress: userData.ipAddress,
        userAgent: userData.userAgent,
        severity: "info"
      });

      // Return user without password
      return safeUser(newUser[0]);
    } catch (error) {
      console.error("User registration error:");
      throw new Error("Failed to register user");
    }
  }

  /**
   * Login a user and generate tokens
   */
  async login(username: string, password: string, ipAddress?: string, userAgent?: string): Promise<AuthResponse> {
    try {
      // Find user by username
      const user = await this.findUserByUsername(username);
      
      if (!user) {
        throw new Error("Invalid credentials");
      }
      
      requireActive(user);
      if (user.lockoutUntil && user.lockoutUntil > new Date()) throw new Error('Account temporarily locked');
      
      // Compare passwords
      const isPasswordValid = await bcrypt.compare(password, user.password);
      
      if (!isPasswordValid) {
        // Skip failed login attempt tracking since failedLoginAttempts field doesn't exist
        await this.incrementFailedLoginAttempts(user.id);
        
        await this.logSecurityEvent({
          eventType: "login_failure",
          userId: user.id,
          description: "Invalid password",
          ipAddress,
          userAgent,
          severity: "warning"
        });
        
        throw new Error("Invalid credentials");
      }
      
      // Generate tokens
      const tokenPayload: TokenPayload = {
        userId: user.id,
        username: user.username,
        role: user.role,
        department: user.department
      };
      
      const accessToken = this.generateAccessToken(tokenPayload);
      const refreshToken = this.generateRefreshToken(tokenPayload);
      
      // Store refresh token in database (only update existing fields)
      await db.update(users)
        .set({ 
          lastLogin: new Date(), failedLoginAttempts: 0, lockoutUntil: null
        })
        .where(eq(users.id, user.id));
      
      // Create auth session
      await db.insert(authSessions).values({
        userId: user.id,
        accessToken,
        refreshToken,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        isActive: true
      });
      
      // Log successful login
      await this.logSecurityEvent({
        eventType: "login_success",
        userId: user.id,
        description: "User logged in successfully",
        ipAddress,
        userAgent,
        severity: "info"
      });
      
      // Remove password from user object
      const userWithoutPassword = safeUser(user);
      
      return {
        user: userWithoutPassword,
        accessToken,
        refreshToken
      };
    } catch (error) {
      console.error("Login error:");
      throw error;
    }
  }

  /**
   * Logout user and invalidate tokens
   */
  async logout(userId: number, refreshToken: string, ipAddress?: string, userAgent?: string) {
    try {
      // Invalidate all sessions with this refresh token
      await db.update(authSessions)
        .set({ isActive: false })
        .where(
          and(
            eq(authSessions.userId, userId),
            eq(authSessions.refreshToken, refreshToken)
          )
        );
      
      // Clear refresh token from user
      await db.update(users)
        .set({ refreshToken: null })
        .where(eq(users.id, userId));
      
      // Log the event
      await this.logSecurityEvent({
        eventType: "logout",
        userId,
        description: "User logged out",
        ipAddress,
        userAgent,
        severity: "info"
      });
      
      return { success: true, message: "Logout successful" };
    } catch (error) {
      console.error("Logout error:");
      throw new Error("Failed to logout");
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string, ipAddress?: string, userAgent?: string) {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, secret('JWT_REFRESH_SECRET'), { algorithms: ['HS256'] }) as TokenPayload;
      
      // Find user with matching refresh token
      const [user] = await db.select()
        .from(users)
        .where(
          and(
            eq(users.id, decoded.userId)
          )
        );
      
      if (!user) {
        throw new Error("Invalid refresh token");
      }
      
      requireActive(user);
      // Check if session is active
      const [session] = await db.select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.userId, user.id),
            eq(authSessions.refreshToken, refreshToken),
            eq(authSessions.isActive, true),
            gt(authSessions.expiresAt, new Date())
          )
        );
      
      if (!session) {
        throw new Error("Session has been invalidated");
      }
      
      // Generate new tokens
      const tokenPayload: TokenPayload = {
        userId: user.id,
        username: user.username,
        role: user.role,
        department: user.department
      };
      
      const newAccessToken = this.generateAccessToken(tokenPayload);
      const newRefreshToken = this.generateRefreshToken(tokenPayload);
      
      // Rotate the session token atomically
      const renewed = await db.update(authSessions)
        .set({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          issuedAt: new Date(),
          lastUsed: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        })
        .where(and(eq(authSessions.id, session.id), eq(authSessions.refreshToken, refreshToken), eq(authSessions.isActive, true)))
        .returning({ id: authSessions.id });
      if (!renewed.length) throw new Error('Refresh token already used');
      // Log the event
      await this.logSecurityEvent({
        eventType: "token_refresh",
        userId: user.id,
        description: "Access token refreshed",
        ipAddress,
        userAgent,
        severity: "info"
      });
      
      // Remove password from user object
      const userWithoutPassword = safeUser(user);
      
      return {
        user: userWithoutPassword,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      console.error("Token refresh error:");
      throw new Error("Failed to refresh token");
    }
  }

  /**
   * Request password reset for a user
   */
  async requestPasswordReset(email: string, ipAddress?: string, userAgent?: string) {
    try {
      if (!emailConfigured()) throw new Error('Password reset email is not configured');
      // Find user by email
      const [user] = await db.select()
        .from(users)
        .where(eq(users.email, email));
      
      if (!user) {
        // Don't reveal that the email doesn't exist
        return { 
          success: true, 
          message: "If your email is registered, you will receive a password reset link"
        };
      }
      
      // Generate a unique reset token
      const resetToken = randomBytes(32).toString('hex');
      
      // Store hashed token in database with expiry (2 hours)
      const hashedToken = hashResetToken(resetToken);
      await db.update(users)
        .set({
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000) // 2 hours
        })
        .where(eq(users.id, user.id));
      
      // Log the event
      await this.logSecurityEvent({
        eventType: "password_reset_request",
        userId: user.id,
        description: "Password reset requested",
        ipAddress,
        userAgent,
        severity: "info"
      });
      
      try {
        await sendPasswordResetEmail(user.email, resetToken);
      } catch {
        await db.update(users).set({ passwordResetToken: null, passwordResetExpires: null })
          .where(and(eq(users.id, user.id), eq(users.passwordResetToken, hashedToken)));
        await this.logSecurityEvent({ eventType: 'error', userId: user.id, description: 'Password reset email delivery failed', severity: 'error' });
      }
      return { success: true, message: 'If your email is registered, you will receive a password reset link' };
    } catch (error) {
      console.error("Password reset request error:");
      throw new Error("Failed to process password reset request");
    }
  }

  /**
   * Reset password using reset token
   */
  async resetPassword(
    resetToken: string, 
    newPassword: string, 
    ipAddress?: string, 
    userAgent?: string
  ) {
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await db.transaction(async tx => {
        const [user] = await tx.update(users).set({ password: hashedPassword, passwordResetToken: null,
          passwordResetExpires: null, refreshToken: null, failedLoginAttempts: 0, lockoutUntil: null })
          .where(and(eq(users.passwordResetToken, hashResetToken(resetToken)), gt(users.passwordResetExpires, new Date())))
          .returning({ id: users.id });
        if (!user) throw new Error('Invalid or expired reset token');
        await tx.update(authSessions).set({ isActive: false }).where(eq(authSessions.userId, user.id));
      });
      return { success: true, message: "Password has been reset successfully" };
    } catch (error) {
      console.error("Password reset error:");
      throw error;
    }
  }

  /**
   * Change password (when user is logged in)
   */
  async changePassword(
    userId: number, 
    currentPassword: string, 
    newPassword: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    try {
      // Find user
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user) {
        throw new Error("User not found");
      }
      
      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      
      if (!isPasswordValid) {
        // Log failed attempt
        await this.logSecurityEvent({
          eventType: "password_change_failure",
          userId: user.id,
          description: "Failed password change attempt - incorrect current password",
          ipAddress,
          userAgent,
          severity: "warning"
        });
        
        throw new Error("Current password is incorrect");
      }
      
      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      
      // Update user password
      await db.update(users)
        .set({ password: hashedPassword, passwordResetToken: null, passwordResetExpires: null, refreshToken: null })
        .where(eq(users.id, userId));
      await db.update(authSessions).set({ isActive: false }).where(eq(authSessions.userId, userId));
      
      // Log the event
      await this.logSecurityEvent({
        eventType: "password_change",
        userId,
        description: "Password changed by user",
        ipAddress,
        userAgent,
        severity: "info"
      });
      
      return { success: true, message: "Password has been changed successfully" };
    } catch (error) {
      console.error("Password change error:");
      throw error;
    }
  }

  /**
   * Admin approval of a user account
   */
  async approveUserAccount(userId: number, approvedByUserId: number) {
    try {
      // Find user to approve
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user) {
        throw new Error("User not found");
      }
      
      const approver = await this.getUserById(approvedByUserId);
      if (userId === approvedByUserId) throw new Error('Cannot approve your own account');
      if (!['admin','super_admin'].includes(approver?.role || '') &&
          !['employee','permanent_employee','temporary_staff'].includes(user.role)) throw new Error('Administrator approval required');
      // Check if already approved
      if (user.approvalStatus === "approved") {
        return { success: true, message: "User is already approved" };
      }
      
      // Update user status
      await db.update(users)
        .set({
          approvalStatus: "approved",
          isActive: true,
          approvedBy: approvedByUserId,
          approvedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      // Log the event
      await this.logSecurityEvent({
        eventType: "user_approval",
        userId: approvedByUserId,
        description: `User account approved: ${user.username}`,
        resourceId: userId.toString(),
        severity: "info"
      });
      
      return { success: true, message: "User account has been approved" };
    } catch (error) {
      console.error("User approval error:");
      throw new Error("Failed to approve user account");
    }
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: number, newRole: string, updatedByUserId: number) {
    try {
      // Find user
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user) {
        throw new Error("User not found");
      }
      
      if (!userRoleEnum.enumValues.includes(newRole as UserRole)) throw new Error('Invalid role');
      if (userId === updatedByUserId) throw new Error('Cannot change your own role');
      // Update role
      await db.update(users)
        .set({ role: newRole as UserRole })
        .where(eq(users.id, userId));
      
      // Log the event
      await this.logSecurityEvent({
        eventType: "role_assignment",
        userId: updatedByUserId,
        description: `User role updated for ${user.username} to ${newRole}`,
        resourceId: userId.toString(),
        severity: "info"
      });
      
      return { success: true, message: "User role has been updated" };
    } catch (error) {
      console.error("Role update error:");
      throw new Error("Failed to update user role");
    }
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, secret('JWT_SECRET'), { algorithms: ['HS256'] }) as TokenPayload;
    } catch (error) {
      throw new Error("Invalid token");
    }
  }

  async authenticateToken(token: string): Promise<TokenPayload> {
    const payload = this.verifyAccessToken(token);
    if (!Number.isInteger(payload.userId)) throw new Error('Invalid token');
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId));
    requireActive(user);
    const [session] = await db.select({ id: authSessions.id }).from(authSessions).where(and(
      eq(authSessions.userId, user.id), eq(authSessions.accessToken, token), eq(authSessions.isActive, true), gt(authSessions.expiresAt, new Date())));
    if (!session) throw new Error('Session has been invalidated');
    return { userId: user.id, username: user.username, role: user.role, department: user.department };
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: number) {
    try {
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user) {
        return null;
      }
      
      // Remove sensitive data
      return safeUser(user);
    } catch (error) {
      console.error("Get user error:");
      throw new Error("Failed to get user");
    }
  }

  /**
   * Find user by username
   */
  async findUserByUsername(username: string) {
    try {
      const [user] = await db.select().from(users).where(eq(users.username, username));
      return user || null;
    } catch (error) {
      console.error("Find user error:");
      throw new Error("Failed to find user");
    }
  }

  /**
   * Find user by email
   */
  async findUserByEmail(email: string) {
    try {
      const [user] = await db.select({
        id: users.id,
        username: users.username,
        password: users.password,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        department: users.department,
        lastLogin: users.lastLogin,
        avatar: users.avatar,
        createdAt: users.createdAt
      })
        .from(users)
        .where(eq(users.email, email));
      
      return user || null;
    } catch (error) {
      console.error("Find user error:");
      throw new Error("Failed to find user");
    }
  }

  /**
   * Get pending users for approval
   */
  async getPendingUsers() {
    try {
      const pendingUsers = await db.select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        department: users.department,
        qidNumber: users.qidNumber,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.approvalStatus, "pending"));
      
      return pendingUsers;
    } catch (error) {
      console.error("Get pending users error:");
      throw new Error("Failed to get pending users");
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(userId: number) {
    try {
      const sessions = await db.select({ id: authSessions.id, userId: authSessions.userId, ipAddress: authSessions.ipAddress,
        userAgent: authSessions.userAgent, issuedAt: authSessions.issuedAt, lastUsed: authSessions.lastUsed, expiresAt: authSessions.expiresAt })
        .from(authSessions)
        .where(
          and(
            eq(authSessions.userId, userId),
            eq(authSessions.isActive, true)
          )
        );
      
      return sessions;
    } catch (error) {
      console.error("Get user sessions error:");
      throw new Error("Failed to get user sessions");
    }
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: number, revokingUserId: number) {
    try {
      // Get session first
      const [session] = await db.select()
        .from(authSessions)
        .where(eq(authSessions.id, sessionId));
      
      if (!session) {
        throw new Error("Session not found");
      }
      
      const actor = await this.getUserById(revokingUserId);
      if (session.userId !== revokingUserId && !['admin', 'super_admin'].includes(actor?.role || '')) throw new Error('Session access denied');
      // Update session
      await db.update(authSessions)
        .set({ isActive: false })
        .where(eq(authSessions.id, sessionId));
      
      // Log the event
      await this.logSecurityEvent({
        eventType: "session_revoked",
        userId: revokingUserId,
        description: `Session revoked for user ID ${session.userId}`,
        resourceId: sessionId.toString(),
        severity: "info"
      });
      
      return { success: true, message: "Session has been revoked" };
    } catch (error) {
      console.error("Revoke session error:");
      throw new Error("Failed to revoke session");
    }
  }

  /**
   * Handle failed login attempts and account lockout
   * Note: Disabled since failedLoginAttempts and lockoutUntil fields don't exist in current DB schema
   */
  private async incrementFailedLoginAttempts(userId: number) {
    await db.update(users).set({
      failedLoginAttempts: sql`coalesce(${users.failedLoginAttempts}, 0) + 1`,
      lockoutUntil: sql`case when coalesce(${users.failedLoginAttempts}, 0) + 1 >= 5 then now() + interval '30 minutes' else ${users.lockoutUntil} end`
    }).where(eq(users.id, userId));
  }

  /**
   * Generate access token
   */
  private generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, secret('JWT_SECRET'), { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRY, jwtid: randomUUID() });
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload, secret('JWT_REFRESH_SECRET'), { algorithm: 'HS256', expiresIn: REFRESH_TOKEN_EXPIRY, jwtid: randomUUID() });
  }

  /**
   * Log security event
   */
  async logSecurityEvent({
    eventType,
    userId,
    description,
    ipAddress,
    userAgent,
    resourceType,
    resourceId,
    metadata,
    severity = "info"
  }: {
    eventType: string;
    userId?: number;
    description: string;
    ipAddress?: string;
    userAgent?: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: any;
    severity?: string;
  }) {
    try {
      await db.insert(securityLogs).values({
        eventType: securityEventTypeEnum.enumValues.includes(eventType as any) ? eventType as any : 'data_access',
        userId,
        description,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        resourceType: resourceType || null,
        resourceId: resourceId || null,
        metadata: metadata ? metadata : null,
        severity
      });
    } catch (error) {
      console.error("Error logging security event:");
    }
  }
}

export const authService = new AuthService();
