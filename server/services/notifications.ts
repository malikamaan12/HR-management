import { eq, desc, and } from "drizzle-orm";
import { db } from "../db";
import { notifications, type InsertNotification, type Notification } from "@shared/schema";
import slackService from "./slack";

// Function to create a notification in the database
export async function createNotification(notification: InsertNotification): Promise<Notification> {
  try {
    const [createdNotification] = await db.insert(notifications)
      .values(notification)
      .returning();
    
    // If notification is for Slack, send it immediately
    if (notification.channel === "slack") {
      await sendSlackNotification(createdNotification);
    }
    
    return createdNotification;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

// Function to get all notifications for a user
export async function getUserNotifications(userId: number): Promise<Notification[]> {
  try {
    const userNotifications = await db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.timestamp))
      .limit(100);
    
    return userNotifications;
  } catch (error) {
    console.error("Error fetching user notifications:", error);
    return [];
  }
}

// Function to mark a notification as delivered
export async function markNotificationDelivered(notificationId: number, userId?: number): Promise<boolean> {
  try {
    const [updated] = await db.update(notifications)
      .set({
        status: "delivered",
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(notifications.id, notificationId),userId ? eq(notifications.userId,userId):undefined))
      .returning();
    
    return !!updated;
  } catch (error) {
    console.error("Error marking notification as delivered:", error);
    return false;
  }
}

// Function to send a notification via Slack
async function sendSlackNotification(notification: Notification): Promise<boolean> {
  try {
    // Determine importance level based on notification data
    const importanceMap: Record<string, 'info' | 'warning' | 'error'> = {
      'document_expiry': 'warning',
      'leave_approved': 'info',
      'leave_rejected': 'error',
      'event_assignment': 'info',
      'system_alert': 'error',
    };
    
    // Extract notification type from data if available
    const notificationType = notification.data ? 
      (notification.data as any).type || 'general' : 
      'general';
    
    const importance = importanceMap[notificationType] || 'info';
    
    // Generate title based on notification type
    let title = "E3 HR System Notification";
    if (notificationType === 'document_expiry') title = "Document Expiry Alert";
    if (notificationType === 'leave_approved') title = "Leave Request Approved";
    if (notificationType === 'leave_rejected') title = "Leave Request Rejected";
    if (notificationType === 'event_assignment') title = "New Event Assignment";
    if (notificationType === 'system_alert') title = "System Alert";
    
    // Send notification using Slack service
    const result = await slackService.sendNotification(
      title,
      notification.message,
      importance
    );
    
    if (result) {
      // Update notification with external ID (Slack timestamp)
      await db.update(notifications)
        .set({
          externalId: result,
          status: "delivered",
          deliveredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notifications.id, notification.id));
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error sending Slack notification:", error);
    return false;
  }
}

export default {
  createNotification,
  getUserNotifications,
  markNotificationDelivered
};