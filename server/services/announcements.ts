import { db } from "../db";
import { 
  announcements, 
  users,
  type InsertAnnouncement, 
  type Announcement,
  employees,
  notificationPreferences,
  notifications
} from "@shared/schema";
import { eq, and, inArray, desc, or, isNull, gt, sql } from "drizzle-orm";
import slackService from "./slack";
import notificationService from "./notifications";

// Function to create an announcement
export async function createAnnouncement(announcement: InsertAnnouncement): Promise<Announcement> {
  try {
    const [createdAnnouncement] = await db.insert(announcements)
      .values(announcement)
      .returning();
    
    // Get author information for notification delivery
    const author = await db.select({
      firstName: users.firstName,
      lastName: users.lastName
    })
    .from(users)
    .where(eq(users.id, announcement.authorId))
    .limit(1);
    
    const authorName = author.length > 0 
      ? `${author[0].firstName} ${author[0].lastName}`
      : "System";
    
    // Send to Slack if the announcement should be broadcast to all platforms
    if (announcement.targetAudience === 'all') {
      await slackService.sendAnnouncement(
        announcement.title,
        announcement.content,
        authorName
      );
    }
    
    // Create notifications for relevant employees
    await notifyEmployeesAboutAnnouncement(createdAnnouncement, authorName);
    
    return createdAnnouncement;
  } catch (error) {
    console.error("Error creating announcement:", error);
    throw error;
  }
}

// Function to get all active announcements
export async function getActiveAnnouncements(limit: number = 10, viewer?: { role: string; department?: string | null }): Promise<Announcement[]> {
  try {
    const now = new Date();
    
    const activeAnnouncements = await db.select()
      .from(announcements)
      .where(and(
        eq(announcements.isActive, true),
        viewer ? or(eq(announcements.targetAudience,'all'),and(eq(announcements.targetAudience,'department'),eq(announcements.targetDepartment,viewer.department || '')),and(eq(announcements.targetAudience,'role'),eq(announcements.targetRole,viewer.role))) : eq(announcements.targetAudience,'all'),
        or(
          isNull(announcements.expiryDate),
          gt(announcements.expiryDate, now.toISOString().slice(0,10))
        )
      ))
      .orderBy(desc(announcements.isPinned), desc(announcements.createdAt))
      .limit(Math.max(1,Math.min(100,Number.isFinite(limit)?limit:10)));
    
    return activeAnnouncements;
  } catch (error) {
    console.error("Error fetching active announcements:", error);
    return [];
  }
}

// Function to get announcements for a specific department
export async function getDepartmentAnnouncements(department: string, limit: number = 10): Promise<Announcement[]> {
  try {
    const now = new Date();
    
    const departmentAnnouncements = await db.select()
      .from(announcements)
      .where(and(
        eq(announcements.isActive, true),
        or(
          isNull(announcements.expiryDate),
          gt(announcements.expiryDate, now.toISOString().slice(0,10))
        ),
        or(
          eq(announcements.targetAudience, 'all'),
          and(
            eq(announcements.targetAudience, 'department'),
            eq(announcements.targetDepartment, department)
          )
        )
      ))
      .orderBy(desc(announcements.isPinned), desc(announcements.createdAt))
      .limit(limit);
    
    return departmentAnnouncements;
  } catch (error) {
    console.error("Error fetching department announcements:", error);
    return [];
  }
}

// Helper function to notify employees about a new announcement
async function notifyEmployeesAboutAnnouncement(announcement: Announcement, authorName: string): Promise<void> {
  try {
    // Build query to find target employees based on announcement target audience
    const targetEmployees = await db.select({id:employees.id,userId:employees.userId}).from(employees)
      .innerJoin(users,eq(users.id,employees.userId))
      .leftJoin(notificationPreferences,eq(notificationPreferences.employeeId,employees.id))
      .where(and(eq(users.isActive,true),or(isNull(notificationPreferences.id),eq(notificationPreferences.announcements,true)),
        announcement.targetAudience === 'department' ? eq(employees.department,announcement.targetDepartment || ''):undefined,
        announcement.targetAudience === 'role' ? sql`${users.role}::text = ${announcement.targetRole || ''}`:undefined));
    
    // Create notification message
    const notificationMessage = `Announcement: ${announcement.title}\n${announcement.content.substring(0, 100)}${announcement.content.length > 100 ? '...' : ''}\nPosted by: ${authorName}`;
    
    // Send notifications to each employee
    for (const employee of targetEmployees) {
      if (employee.userId) {
        // Create in-app notification
        await notificationService.createNotification({
          userId: employee.userId,
          message: notificationMessage,
          channel: 'push',
          status: 'pending',
          data: {
            type: 'announcement',
            announcementId: announcement.id,
            title: announcement.title
          }
        });
      }
    }
  } catch (error) {
    console.error("Error notifying employees about announcement:", error);
  }
}

export default {
  createAnnouncement,
  getActiveAnnouncements,
  getDepartmentAnnouncements
};