import {z} from 'zod';
import {civilDate,positiveId,reason} from './hr-rules';

export const locationFix=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy:z.number().finite().positive().max(100000),capturedAt:z.string().datetime()}).strict();
export const geofencePolicy=z.object({required:z.boolean(),maxAccuracyMeters:z.number().int().min(5).max(500),maxAgeSeconds:z.number().int().min(10).max(300),requirePermanentApproval:z.boolean()}).strict();
export const defaultGeofencePolicy={required:false,maxAccuracyMeters:100,maxAgeSeconds:90,requirePermanentApproval:false};
export const geofenceDefinition=z.object({name:z.string().trim().min(2).max(160),latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),radiusMeters:z.number().int().min(20).max(10000),enabled:z.boolean(),siteId:positiveId.nullable(),employeeIds:z.array(positiveId).max(5000),startsOn:civilDate.nullable(),endsOn:civilDate.nullable()}).strict().superRefine((v,c)=>{if(v.startsOn&&v.endsOn&&v.endsOn<v.startsOn)c.addIssue({code:'custom',path:['endsOn'],message:'End date must follow start date'});if(new Set(v.employeeIds).size!==v.employeeIds.length)c.addIssue({code:'custom',path:['employeeIds'],message:'Do not repeat an employee'});});
export const geofenceSave=z.object({version:z.number().int().min(0),config:geofenceDefinition,reason}).strict();
export type LocationFix=z.infer<typeof locationFix>;
export type GeofencePolicy=z.infer<typeof geofencePolicy>;
export type GeofenceDefinition=z.infer<typeof geofenceDefinition>;
export interface LocationEvidence {status:'verified'|'disabled'|'exception';recordedAt:string;policyVersion:number;fix?:LocationFix;fence?:{id:number;version:number;name:string;latitude:number;longitude:number;radiusMeters:number};distanceMeters?:number;reason?:string}
export function distanceMeters(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r,h=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
