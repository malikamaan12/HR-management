import { Router, type Response } from 'express';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { employees, activityLogs, users, employeeLifecycleEvents, insertEmployeeLifecycleEventSchema, type Employee } from '@shared/schema';
import { directoryFields, employeeWriteFields, checkEmploymentDates, type EmployeeRecord } from '@shared/employee-records';
import { authenticate } from '../middleware/auth';
import { employeeScope } from '../services/access';
import type { TokenPayload } from '../services/auth';
import { hasPermission } from '@shared/permissions';
import { localDate } from '@shared/workforce';
import {syncEmploymentService,endEmploymentAccess} from '../services/employment';

const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const idSchema = z.coerce.number().int().positive();
const writers = new Set(['super_admin', 'admin', 'hr_director', 'hr']);
const privateReaders = new Set([...writers, 'hr_manager']);
const bankReaders = new Set(['payroll_specialist', 'finance', 'finance_audit']);
const canWrite = (user: TokenPayload) => writers.has(user.role);
const directory = (row: Employee) => Object.fromEntries(directoryFields.map(key => [key, row[key]]));
function project(row: Employee, user: TokenPayload) {
  const personal = privateReaders.has(user.role) || row.userId === user.userId;
  const banking = personal || bankReaders.has(user.role);
  const result = personal ? { ...row } : { ...directory(row), ...(banking ? {
    qidNumber: row.qidNumber, bankName: row.bankName, ibanNumber: row.ibanNumber,
    swiftCode: row.swiftCode, bankBranch: row.bankBranch, accountName: row.accountName,
    costCenter: row.costCenter, contractEndDate: row.contractEndDate,
  } : {}) };
  return { ...result, access: { canEdit: canWrite(user), personal, banking, documents: false, uploadDocuments: false, history: personal } } as EmployeeRecord;
}
class RecordError extends Error { constructor(public status: number, message: string) { super(message); } }
const rejectEmployment=(status:number,message:string):never=>{throw new RecordError(status,message);};
function fail(res: Response, error: unknown) {
  if (error instanceof RecordError) return res.status(error.status).json({ message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ message: 'Check the employee fields: ' + error.issues.map(i => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '), errors: error.flatten() });
  const code = (error as {code?: string; cause?: {code?: string}})?.code || (error as {cause?: {code?: string}})?.cause?.code;
  if (code === '23505') return res.status(409).json({ message: 'Employee ID or QID is already in use. Check the existing employee record.' });
  if (code === '23503') return res.status(400).json({ message: 'A selected related record no longer exists. Reload and try again.' });
  console.error('Employee record operation failed');
  return res.status(500).json({ message: 'Unable to complete the employee request' });
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  q: z.string().trim().max(200).optional(),
  type: z.enum(['permanent', 'temporary', 'contract']).optional(),
  status: z.enum(['active', 'inactive', 'on_leave']).optional(),
  department: z.string().trim().max(250).optional(),
});
router.get(['/', '/directory'], async (req, res) => {
  try {
    if (!hasPermission(req.user!.role, 'employee_database', 'read')) throw new RecordError(403, 'Employee directory access is required');
    const query = querySchema.parse(req.query);
    // Escape LIKE wildcards so names such as "A_1" are searched literally.
    const search = query.q ? `%${query.q.replace(/[\\%_]/g, '\\$&')}%` : undefined;
    const where = and(employeeScope(req.user!, 'employee_database'),
      query.type ? eq(employees.type, query.type) : undefined,
      query.status ? eq(employees.status, query.status) : undefined,
      query.department ? eq(employees.department, query.department) : undefined,
      search ? or(ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`, search), ilike(employees.fullNameArabic, search),
        ilike(employees.employeeId, search), ilike(employees.department, search), ilike(employees.position, search), ilike(employees.location, search)) : undefined);
    // One snapshot keeps the count and page consistent during concurrent changes.
    const result = await db.transaction(async tx => {
      const [{ total }] = await tx.select({ total: count() }).from(employees).where(where);
      const rows = await tx.select().from(employees).where(where).orderBy(employees.lastName, employees.firstName, employees.id)
        .limit(query.limit).offset((query.page - 1) * query.limit);
      return { total, rows };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    if (req.path === '/') return res.json(result.rows.map(row => project(row, req.user!)));
    return res.json({ employees: result.rows.map(directory), total: result.total, page: query.page, limit: query.limit, canCreate: canWrite(req.user!) });
  } catch (error) { return fail(res, error); }
});

router.get('/:id/activity', async (req, res) => {
  try {
    const id = idSchema.parse(req.params.id);
    const [row] = await db.select().from(employees).where(and(eq(employees.id, id), employeeScope(req.user!, 'employee_database')));
    if (!row) throw new RecordError(404, 'Employee not found');
    if (!project(row, req.user!).access.history) throw new RecordError(403, 'Employee history access is required');
    const page = querySchema.parse(req.query);
    const where = and(eq(activityLogs.entityType, 'employee'), eq(activityLogs.entityId, id));
    const [{ total }] = await db.select({ total: count() }).from(activityLogs).where(where);
    const history = await db.select({ id: activityLogs.id, action: activityLogs.action, details: activityLogs.details,
      createdAt: activityLogs.createdAt, actor: sql<string | null>`${users.firstName} || ' ' || ${users.lastName}` }).from(activityLogs)
      .leftJoin(users, eq(activityLogs.userId, users.id)).where(where).orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(page.limit).offset((page.page - 1) * page.limit);
    return res.json({ history, total, page: page.page, limit: page.limit });
  } catch (error) { return fail(res, error); }
});
router.get('/:id', async (req, res) => {
  try {
    const id = idSchema.parse(req.params.id);
    const [row] = await db.select().from(employees).where(and(eq(employees.id, id), employeeScope(req.user!, 'employee_database')));
    if (!row) throw new RecordError(404, 'Employee not found');
    const record = project(row, req.user!);
    const managerIds = [row.reportingManagerId, row.secondaryManagerId].filter((id): id is number => id !== null);
    const managers = managerIds.length ? await db.select({ id: employees.id, employeeId: employees.employeeId, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees).where(and(inArray(employees.id, managerIds), employeeScope(req.user!, 'employee_database'))) : [];
    record.managers = { primary: managers.find(manager => manager.id === row.reportingManagerId) || null, secondary: managers.find(manager => manager.id === row.secondaryManagerId) || null };
    const [read] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), employeeScope(req.user!, 'compliance_documents')));
    const [upload] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), employeeScope(req.user!, 'compliance_documents', 'create')));
    record.access.documents = !!read;
    record.access.uploadDocuments = !!upload;
    return res.json(record);
  } catch (error) { return fail(res, error); }
});

const patchSchema = employeeWriteFields.partial().extend({ expectedVersion: z.number().int().positive() }).strict();
const lifecycleSchema = insertEmployeeLifecycleEventSchema.omit({ employeeId: true }).extend({
  expectedVersion: z.number().int().positive(),
  eventType: z.enum(['hire','transfer','promotion','probation_started','probation_completed','contract_renewal','termination','reactivation','correction']),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Invalid effective date'),
  reason: z.string().trim().min(5).max(500),
  notes: z.string().trim().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

router.get('/:id/lifecycle', async (req, res) => {
  try {
    const id = idSchema.parse(req.params.id);
    const [employee] = await db.select().from(employees).where(and(eq(employees.id, id), employeeScope(req.user!, 'employee_database')));
    if (!employee) throw new RecordError(404, 'Employee not found');
    if (!project(employee, req.user!).access.history) throw new RecordError(403, 'Employee history access is required');
    const history = await db.select({ id: employeeLifecycleEvents.id, eventType: employeeLifecycleEvents.eventType,
      effectiveDate: employeeLifecycleEvents.effectiveDate, reason: employeeLifecycleEvents.reason,
      notes: employeeLifecycleEvents.notes, metadata: employeeLifecycleEvents.metadata,
      createdAt: employeeLifecycleEvents.createdAt,
      actor: sql<string | null>`${users.firstName} || ' ' || ${users.lastName}` })
      .from(employeeLifecycleEvents).leftJoin(users, eq(employeeLifecycleEvents.createdBy, users.id))
      .where(eq(employeeLifecycleEvents.employeeId, id)).orderBy(desc(employeeLifecycleEvents.effectiveDate), desc(employeeLifecycleEvents.id));
    return res.json({ history });
  } catch (error) { return fail(res, error); }
});

router.post('/:id/lifecycle', async (req, res) => {
  try {
    if (!canWrite(req.user!)) throw new RecordError(403, 'HR administrator access is required to record lifecycle events');
    const id = idSchema.parse(req.params.id), input = lifecycleSchema.parse(req.body);
    const result = await db.transaction(async tx => {
      const [employee] = await tx.select().from(employees).where(and(eq(employees.id, id), employeeScope(req.user!, 'employee_database', 'update'))).for('update');
      if (!employee) throw new RecordError(404, 'Employee not found');
      if (employee.recordVersion !== input.expectedVersion) throw new RecordError(409, 'This employee was changed. Reload the profile before recording this event.');
      if (input.effectiveDate < employee.joiningDate) throw new RecordError(400, 'The effective date must be on or after joining date');
      const changesStatus = input.eventType === 'termination' || input.eventType === 'reactivation';
      if (changesStatus && input.effectiveDate > localDate(new Date(), process.env.APP_TIMEZONE || 'Asia/Qatar')) throw new RecordError(400, 'Status changes take effect immediately. Use today or a past effective date.');
      if (input.eventType === 'termination' && employee.status === 'inactive') throw new RecordError(409, 'This employee is already inactive');
      if (input.eventType === 'termination' && employee.userId === req.user!.userId) throw new RecordError(400, 'Ask another HR administrator to terminate your employment');
      if (input.eventType === 'reactivation' && employee.status !== 'inactive') throw new RecordError(400, 'Only inactive employees can be reactivated');
      if (input.eventType === 'reactivation' && employee.terminationDate && input.effectiveDate < employee.terminationDate) throw new RecordError(400, 'Reactivation must be on or after termination');
      const [event] = await tx.insert(employeeLifecycleEvents).values({ employeeId: id, eventType: input.eventType,
        effectiveDate: input.effectiveDate, reason: input.reason, notes: input.notes ?? null,
        metadata: input.metadata ?? null, createdBy: req.user!.userId }).returning();
      let updated = employee;
      if (input.eventType === 'termination') {
        const {equipmentClearance}=await import('../services/equipment');
        const clearance=await equipmentClearance(tx,id);
        if(clearance.blocked)throw new RecordError(409,`Resolve ${clearance.openCount} open equipment issue(s) before terminating employment`);
        const openChecklist=await tx.execute(sql`SELECT id FROM lifecycle_cases WHERE employee_id=${id} AND kind='offboarding' AND status='in_progress' LIMIT 1`);
        if(openChecklist.rows.length)throw new RecordError(409,'Complete the open offboarding checklist to terminate this employee');
        await syncEmploymentService(tx,req.user!,employee,'termination',input.effectiveDate,input.reason,{kind:'employee_lifecycle',lifecycleEventId:event.id},rejectEmployment);
        await endEmploymentAccess(tx,employee,input.effectiveDate,rejectEmployment);
        [updated] = await tx.update(employees).set({ status: 'inactive', terminationDate: input.effectiveDate, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
      } else if (input.eventType === 'reactivation') {
        await syncEmploymentService(tx,req.user!,employee,'reactivation',input.effectiveDate,input.reason,{kind:'employee_lifecycle',lifecycleEventId:event.id},rejectEmployment);
        [updated] = await tx.update(employees).set({ status: 'active', terminationDate: null, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
      } else {
        [updated] = await tx.update(employees).set({ updatedAt: new Date() }).where(eq(employees.id, id)).returning();
      }
      await tx.insert(activityLogs).values({ userId: req.user!.userId, action: 'update', entityType: 'employee_lifecycle', entityId: id,
        details: `Recorded ${input.eventType} event effective ${input.effectiveDate}` });
      return { event, employee: project(updated, req.user!) };
    });
    return res.status(201).json(result);
  } catch (error) { return fail(res, error); }
});

router.post('/', async (req, res) => {
  try {
    if (!canWrite(req.user!)) throw new RecordError(403, 'HR administrator access is required to create employees');
    const input = employeeWriteFields.parse(req.body);
    const dateError = checkEmploymentDates(input); if (dateError) throw new RecordError(400, dateError);
    const row = await db.transaction(async tx => {
      await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);
      await validateManagers(tx, input);
      const [created] = await tx.insert(employees).values(input).returning();
      await tx.insert(activityLogs).values({ userId: req.user!.userId, action: 'create', entityType: 'employee', entityId: created.id, details: 'Employee record created' });
      return created;
    });
    return res.status(201).json(project(row, req.user!));
  } catch (error) { return fail(res, error); }
});
router.patch('/:id', async (req, res) => {
  try {
    if (!canWrite(req.user!)) throw new RecordError(403, 'HR administrator access is required to edit employees');
    const id = idSchema.parse(req.params.id);
    const { expectedVersion, ...patch } = patchSchema.parse(req.body);
    if (!Object.keys(patch).length) throw new RecordError(400, 'No employee changes supplied');
    const row = await db.transaction(async tx => {
      // Serializes hierarchy edits so two API updates cannot create a reporting cycle.
      await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);
      const [current] = await tx.select().from(employees).where(and(eq(employees.id, id), employeeScope(req.user!, 'employee_database', 'update')));
      if (!current) throw new RecordError(404, 'Employee not found');
      if (current.recordVersion !== expectedVersion) throw new RecordError(409, 'This employee was changed by someone else. Close the form, reload the profile and apply your changes again.');
      if(patch.status&&patch.status!==current.status&&(patch.status==='inactive'||current.status==='inactive'))throw new RecordError(409,'Use the employee lifecycle termination or reactivation workflow to change active employment');
      const dateError = checkEmploymentDates({ ...current, ...patch }); if (dateError) throw new RecordError(400, dateError);
      await validateManagers(tx, {
        reportingManagerId: patch.reportingManagerId !== current.reportingManagerId ? patch.reportingManagerId : undefined,
        secondaryManagerId: patch.secondaryManagerId !== current.secondaryManagerId ? patch.secondaryManagerId : undefined,
      }, id);
      const changed = Object.keys(patch).filter(key => current[key as keyof Employee] !== patch[key as keyof typeof patch]);
      if (!changed.length) return current;
      const [updated] = await tx.update(employees).set(patch).where(eq(employees.id, id)).returning();
      await tx.insert(activityLogs).values({ userId: req.user!.userId, action: 'update', entityType: 'employee', entityId: id,
        details: 'Updated fields: ' + changed.join(', ') });
      return updated;
    });
    return res.json(project(row, req.user!));
  } catch (error) { return fail(res, error); }
});

export async function validateManagers(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], input: { reportingManagerId?: number | null; secondaryManagerId?: number | null }, employeeId?: number) {
  if (input.reportingManagerId === undefined && input.secondaryManagerId === undefined) return;
  const rows = await tx.select({ id: employees.id, reportingManagerId: employees.reportingManagerId, secondaryManagerId: employees.secondaryManagerId, status: employees.status }).from(employees);
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const managerId of [input.reportingManagerId, input.secondaryManagerId]) {
    if (managerId == null) continue;
    if (!byId.has(managerId)) throw new RecordError(400, 'Selected manager does not exist');
    if (byId.get(managerId)!.status === 'inactive') throw new RecordError(400, 'Select an active manager');
    const pending = [managerId], visited = new Set<number>();
    while (pending.length) {
      const next = pending.pop()!;
      if (next === employeeId) throw new RecordError(400, 'Reporting managers cannot create a cycle or report to themselves');
      if (visited.has(next)) continue;
      visited.add(next);
      const manager = byId.get(next);
      for (const parent of [manager?.reportingManagerId, manager?.secondaryManagerId]) if (parent != null) pending.push(parent);
    }
  }
}
export default router;
