import {z} from 'zod';
import {timezone} from './hr-rules';
export const operationalReminderConfig=z.object({
 enabled:z.boolean(),timezone,
 notifyDocuments:z.boolean(),documentDays:z.number().int().min(0).max(365),
 notifyTraining:z.boolean(),trainingDays:z.number().int().min(0).max(365),
 notifyHandbooks:z.boolean(),handbookDays:z.number().int().min(0).max(365),
 notifyEquipment:z.boolean(),equipmentDays:z.number().int().min(0).max(365),
 notifyApprovals:z.boolean(),includeOverdue:z.boolean(),
 repeatHours:z.number().int().min(6).max(720),maxPerRun:z.number().int().min(50).max(5000),
}).strict();
export type OperationalReminderConfig=z.infer<typeof operationalReminderConfig>;
export const defaultOperationalReminders:OperationalReminderConfig={
 enabled:true,timezone:'Asia/Qatar',notifyDocuments:true,documentDays:30,
 notifyTraining:true,trainingDays:7,notifyHandbooks:true,handbookDays:7,
 notifyEquipment:true,equipmentDays:7,notifyApprovals:true,includeOverdue:true,repeatHours:24,maxPerRun:500,
};
export type OperationalReminderPolicy={version:number;config:OperationalReminderConfig};
