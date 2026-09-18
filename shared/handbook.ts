import { z } from 'zod';
import { civilDate, positiveId, reason } from './hr-rules';

export const handbookContent = z.object({ title:z.string().trim().min(3).max(200), summary:z.string().trim().max(1000), body:z.string().trim().min(20).max(100000), effectiveOn:civilDate }).strict();
export const handbookCreate = handbookContent.extend({ category:z.string().trim().min(2).max(80), reason });
export const handbookRevise = handbookContent.extend({ version:positiveId, reason });
export const handbookPolicyInput = z.object({ version:z.number().int().min(0), defaultDueDays:z.number().int().min(1).max(365), requiredByDefault:z.boolean(), acknowledgementText:z.string().trim().min(10).max(1000), reason }).strict();
export const handbookAssign = z.object({ editionId:positiveId, employeeIds:z.array(positiveId).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,'Select each employee only once'), dueDate:civilDate, required:z.boolean(), supersedePending:z.boolean().default(true), reason }).strict();
export interface HandbookPolicy { version:number; defaultDueDays:number; requiredByDefault:boolean; acknowledgementText:string; }
export interface HandbookEdition { id:number; handbook_id:number; edition_number:number; version:number; title:string; summary:string; body:string; body_hash:string; effective_on:string; status:'draft'|'published'; published_at:string|null; published_by:number|null; created_at:string; }
export interface HandbookBook { id:number; category:string; active:boolean; version:number; title:string; edition_id:number; edition_number:number; edition_status:'draft'|'published'; effective_on:string; }
export interface HandbookAssignment { id:number; handbook_id:number; edition_id:number; employee_id:number; employee_name?:string; title:string; edition_number:number; due_date:string; required:boolean; status:'pending'|'acknowledged'|'superseded'|'withdrawn'; version:number; read_at:string|null; acknowledged_at:string|null; acknowledged_by:number|null; policy_snapshot:HandbookPolicy; body_hash:string; created_at:string; }
