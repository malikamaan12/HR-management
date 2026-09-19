import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { notifications, type InsertNotification, type Notification } from '@shared/schema';
import { WorkflowError } from './workflowRecords';

export async function createNotification(notification: InsertNotification): Promise<Notification> {
  if (notification.channel !== 'push') throw new WorkflowError(400, 'The Communication Hub creates in-app notifications only');
  const [created] = await db.insert(notifications).values(notification).returning(); return created;
}
export async function getUserNotifications(userId: number): Promise<Notification[]> {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.timestamp)).limit(100);
}
// Compatibility endpoint: record the reader separately without inventing external delivery.
export async function markNotificationDelivered(notificationId: number, userId?: number): Promise<boolean> {
  if (!userId) return false;
  if (!(await db.execute(sql`SELECT id FROM notifications WHERE id=${notificationId} AND user_id=${userId}`)).rows.length) return false;
  await db.execute(sql`INSERT INTO comm_notification_reads(notification_id,user_id) VALUES(${notificationId},${userId}) ON CONFLICT DO NOTHING`);
  return true;
}
export default { createNotification, getUserNotifications, markNotificationDelivered };
