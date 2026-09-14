import type * as Schema from '@shared/schema';
export type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? {[K in keyof T]:Jsonify<T[K]>} : T;
export type ApiEmployee = Jsonify<Schema.Employee>;
export type ApiEmployeeRecord = Jsonify<import('@shared/employee-records').EmployeeRecord>;
export type ApiEmployeeDirectory = Jsonify<import('@shared/employee-records').EmployeeDirectory>;
export type ApiEmployeeHistory = Jsonify<import('@shared/employee-records').EmployeeHistory>;
export type ApiDocument = Jsonify<Schema.Document> & { employeeName?: string };
export type ApiAttendance = Jsonify<Schema.Attendance> & { employeeName?: string; breakDurationMinutes?: number };
export type ApiShift = Jsonify<Schema.ShiftSchedule> & { employeeName?: string };
export type ApiGeofence = Jsonify<Schema.Geofence>;
export type ApiReview = Jsonify<Schema.PerformanceReview>;
export type ApiGoal = Jsonify<Schema.EmployeeGoal>;
export type ApiFeedback = Jsonify<Schema.EmployeeFeedback>;
export type ApiNotification = Jsonify<Schema.Notification>;
export type ApiAnnouncement = Jsonify<Schema.Announcement>;
export type ApiNotificationPreferences = Jsonify<Schema.NotificationPreference>;
export interface PerformanceStats {avgRating:number;totalReviews:number;upcomingReviews:number;performanceTrends:{category:string;score:number;change:number|null}[];}
export interface SlackStatus {connected:boolean;channelId?:string;}
export interface SlackUserIntegration {integrated:boolean;slackUsername?:string;slackEmail?:string;isActive?:boolean;lastSynced?:string;}
