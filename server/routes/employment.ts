import { Router } from 'express';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { employees, employeeLifecycleEvents } from '@shared/schema';
import { employmentChangeInput, employmentPolicyInput, employmentWriter, employmentAdministrator, employmentReviewer, servicePeriodRequestInput, type EmploymentChange, type EmploymentPatch, type ServicePeriod, type ServicePeriodRequest } from '@shared/employment';
import { positiveId, reason } from '@shared/hr-rules';
import { authenticate } from '../middleware/auth';
import { recordHandler as handle, recordHistory, qatarToday, requireAdmin } from '../services/workflowRecords';
import { employmentEmployee, employmentEmployeeView, employmentFail as fail, employmentPolicy, employmentScope, employmentVersion, requireEmploymentWriter, independentEmploymentReviewer, daysBetween, validateChange, validateEmploymentManagers, validateServicePeriod, serviceContinuity } from '../services/employment';

const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const pageInput = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), employeeId: positiveId.optional(), status: z.enum(['requested', 'approved', 'rejected', 'cancelled', 'applied']).optional() });
const actionInput = z.object({ version: positiveId, action: z.enum(['approve', 'reject', 'cancel', 'apply']), reason }).strict();
const periodActionInput = z.object({ version: positiveId, action: z.enum(['approve', 'reject', 'cancel']), reason }).strict();

router.get('/context', handle(async (req, res) => {
  const q = z.string().trim().max(100).parse(req.query.q || ''), term = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const rows = await db.select({ id: employees.id, employeeId: employees.employeeId, name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`, department: employees.department, position: employees.position, status: employees.status })
    .from(employees).where(and(employmentScope(req), q ? or(ilike(employees.employeeId, term), ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`, term)) : undefined)).orderBy(employees.firstName, employees.id).limit(100);
  res.json({ employees: rows, canManage: employmentWriter(req.user.role), canConfigure: employmentAdministrator(req.user.role) });
}));
router.get('/policy', handle(async (_req, res) => res.json(await employmentPolicy(db))));
router.get('/policy/history', handle(async (req, res) => {
  requireAdmin(req);
  res.json((await db.execute(sql`SELECT version,definition,reason,created_by,created_at FROM employment_policies ORDER BY version DESC LIMIT 100`)).rows);
}));
router.post('/policy', handle(async (req, res) => {
  requireAdmin(req);
  const input = z.object({ expectedVersion: z.number().int().min(0), definition: employmentPolicyInput, reason }).strict().parse(req.body);
  const result = await db.transaction(async tx => {
    await tx.execute(sql`LOCK TABLE employment_policies IN SHARE ROW EXCLUSIVE MODE`);
    const current = await employmentPolicy(tx);
    if (current.version !== input.expectedVersion) fail(409, 'Policy changed. Reload before saving.');
    const { rows } = await tx.execute(sql`INSERT INTO employment_policies(version,definition,created_by,reason) VALUES (${current.version + 1},${JSON.stringify(input.definition)}::jsonb,${req.user.userId},${input.reason}) RETURNING *`);
    await recordHistory(tx, req, 'employment_policy', rows[0], input.reason);
    return { ...input.definition, version: current.version + 1 };
  });
  res.status(201).json(result);
}));
router.get('/employees/:id', handle(async (req, res) => {
  const row = await employmentEmployee(db, req, positiveId.parse(req.params.id));
  res.json(employmentEmployeeView(row));
}));

router.get('/changes', handle(async (req, res) => {
  const input = pageInput.parse(req.query), scope = employmentScope(req);
  const where = sql`${scope} ${input.employeeId ? sql`AND c.employee_id=${input.employeeId}` : sql``} ${input.status ? sql`AND c.status=${input.status}` : sql``}`;
  const data = await db.execute(sql`SELECT c.id,c.employee_id,c.kind,c.effective_date,c.status,c.version,c.created_at,
    employees.first_name || ' ' || employees.last_name AS employee_name,employees.employee_id AS employee_code
    FROM employment_changes c JOIN employees ON employees.id=c.employee_id WHERE ${where}
    ORDER BY c.id DESC LIMIT 25 OFFSET ${(input.page - 1) * 25}`);
  const total = await db.execute(sql`SELECT count(*)::integer AS total FROM employment_changes c JOIN employees ON employees.id=c.employee_id WHERE ${where}`);
  res.json({ items: data.rows, total: total.rows[0].total, page: input.page });
}));

router.post('/changes', handle(async (req, res) => {
  requireEmploymentWriter(req);
  const input = employmentChangeInput.parse(req.body);
  const row = await db.transaction(async tx => {
    await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);
    const employee = await employmentEmployee(tx, req, input.employeeId, true), policy = await employmentPolicy(tx);
    if (employee.recordVersion !== input.expectedEmployeeVersion) fail(409, 'Employee profile changed. Reload and prepare the change again.');
    const offset = daysBetween(qatarToday(), input.effectiveDate);
    if (offset < -policy.maxBackdatedDays || offset > policy.maxFutureDays) fail(400, `The effective date must be within ${policy.maxBackdatedDays} days in the past and ${policy.maxFutureDays} days in the future`);
    validateChange(employee, input.changes, input.effectiveDate);
    await validateEmploymentManagers(tx, employee.id, input.changes);
    if (input.kind === 'contract_renewal' && (!input.changes.contractEndDate || (employee.contractEndDate && input.changes.contractEndDate <= employee.contractEndDate))) fail(400, 'A renewal must specify a later contract end date');
    const changed = Object.entries(input.changes).filter(([key, value]) => employee[key as keyof typeof employee] !== value);
    if (!changed.length) fail(400, 'The proposed values match the current employee record');
    const before = Object.fromEntries(changed.map(([key]) => [key, employee[key as keyof typeof employee]])), after = Object.fromEntries(changed);
    const { rows } = await tx.execute(sql`INSERT INTO employment_changes(employee_id,employee_version,kind,effective_date,before_values,after_values,policy_snapshot,reason,requested_by)
      VALUES (${employee.id},${employee.recordVersion},${input.kind},${input.effectiveDate}::date,${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb,${JSON.stringify(policy)}::jsonb,${input.reason},${req.user.userId}) RETURNING *`);
    await recordHistory(tx, req, 'employment_change', rows[0], input.reason);
    return rows[0];
  });
  res.status(201).json(row);
}));

router.get('/changes/:id', handle(async (req, res) => {
  const id = positiveId.parse(req.params.id);
  const rows = await db.execute(sql`SELECT c.* FROM employment_changes c JOIN employees ON employees.id=c.employee_id WHERE c.id=${id} AND ${employmentScope(req)}`);
  const row = rows.rows[0] as EmploymentChange | undefined;
  if (!row) return fail(404, 'Employment change not found');
  const employee = await employmentEmployee(db, req, row.employee_id);
  const history = await db.execute(sql`SELECT version,reason,actor_id,created_at,snapshot FROM hr_workflow_history WHERE kind='employment_change' AND record_id=${id} ORDER BY version DESC LIMIT 100`);
  res.json({ row, employee: employmentEmployeeView(employee), history: history.rows,
    canReview: employmentReviewer(req.user.role, row.policy_snapshot) && ![row.requested_by, employee.userId].includes(req.user.userId),
    canCancel: employmentWriter(req.user.role) && (row.requested_by === req.user.userId || employmentAdministrator(req.user.role)),
    canApply: employmentWriter(req.user.role) && employee.userId !== req.user.userId,
  });
}));

router.post('/changes/:id/actions', handle(async (req, res) => {
  requireEmploymentWriter(req);
  const id = positiveId.parse(req.params.id), input = actionInput.parse(req.body);
  const result = await db.transaction(async tx => {
    // Lock hierarchy before the workflow row, matching profile and bulk-import edits.
    await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);
    const found = await tx.execute(sql`SELECT employee_id FROM employment_changes WHERE id=${id}`);
    if (!found.rows.length) fail(404, 'Employment change not found');
    const employee = await employmentEmployee(tx, req, Number(found.rows[0].employee_id), true);
    const locked = await tx.execute(sql`SELECT * FROM employment_changes WHERE id=${id} FOR UPDATE`), row = locked.rows[0] as EmploymentChange;
    employmentVersion(row, input.version);
    let saved: any;
    if (input.action === 'cancel') {
      if (!['requested', 'approved'].includes(row.status)) fail(409, 'Only pending or approved changes can be cancelled');
      if (row.requested_by !== req.user.userId && !employmentAdministrator(req.user.role)) fail(403, 'Only the preparer or an administrator can cancel this request');
      saved = await tx.execute(sql`UPDATE employment_changes SET status='cancelled',decision_reason=${input.reason},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`);
    } else if (input.action === 'approve' || input.action === 'reject') {
      if (row.status !== 'requested') fail(409, 'This request has already been reviewed');
      independentEmploymentReviewer(req, employee, row);
      if (input.action === 'approve') {
        if (employee.recordVersion !== row.employee_version) fail(409, 'Employee profile changed. Cancel this request and prepare a new proposal from the current profile.');
        validateChange(employee, row.after_values, row.effective_date);
        await validateEmploymentManagers(tx, employee.id, row.after_values);
      }
      saved = await tx.execute(sql`UPDATE employment_changes SET status=${input.action === 'approve' ? 'approved' : 'rejected'},reviewed_by=${req.user.userId},reviewed_at=now(),decision_reason=${input.reason},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`);
    } else {
      if (row.status !== 'approved') fail(409, 'Only approved changes can be applied');
      if (employee.userId === req.user.userId) fail(403, 'Another HR administrator must apply your employment change');
      if (row.effective_date > qatarToday()) fail(409, 'This change is scheduled for a future date. Apply it on or after that date.');
      if (employee.recordVersion !== row.employee_version) fail(409, 'Employee profile changed after preparation. Cancel this request and create a new proposal.');
      validateChange(employee, row.after_values, row.effective_date);
      await validateEmploymentManagers(tx, employee.id, row.after_values);
      await tx.update(employees).set({ ...(row.after_values as EmploymentPatch), updatedAt: new Date() }).where(eq(employees.id, employee.id));
      await tx.insert(employeeLifecycleEvents).values({ employeeId: employee.id, eventType: row.kind, effectiveDate: row.effective_date,
        reason: row.reason, notes: input.reason, metadata: { employmentChangeId: row.id, before: row.before_values, after: row.after_values, reviewedBy: row.reviewed_by, policyVersion: row.policy_snapshot.version }, createdBy: req.user.userId });
      saved = await tx.execute(sql`UPDATE employment_changes SET status='applied',applied_by=${req.user.userId},applied_at=now(),decision_reason=${input.reason},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`);
    }
    await recordHistory(tx, req, 'employment_change', saved.rows[0], input.reason);
    return saved.rows[0];
  });
  res.json(result);
}));

router.get('/service/:employeeId', handle(async (req, res) => {
  const employee = await employmentEmployee(db, req, positiveId.parse(req.params.employeeId));
  const page = pageInput.parse(req.query).page;
  const periods = (await db.execute(sql`SELECT * FROM employment_service_periods WHERE employee_id=${employee.id} ORDER BY start_date,id`)).rows as ServicePeriod[];
  const requests = (await db.execute(sql`SELECT * FROM employment_period_requests WHERE employee_id=${employee.id} ORDER BY (status='requested') DESC,id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`)).rows as ServicePeriodRequest[];
  const requestCount = (await db.execute(sql`SELECT count(*)::integer AS total FROM employment_period_requests WHERE employee_id=${employee.id}`)).rows[0];
  const policy = await employmentPolicy(db);
  res.json({ employee: employmentEmployeeView(employee), periods, policy, summary: serviceContinuity(periods, employee, policy),
    requests: requests.map(row => ({ ...row,
      canReview: employmentReviewer(req.user.role, row.policy_snapshot) && ![employee.userId, row.requested_by].includes(req.user.userId),
      canCancel: employmentWriter(req.user.role) && (row.requested_by === req.user.userId || employmentAdministrator(req.user.role)),
    })), requestTotal: requestCount.total, canManage: employmentWriter(req.user.role) });
}));

router.get('/period-requests', handle(async (req, res) => {
  const input = pageInput.parse(req.query), where = sql`${employmentScope(req)} ${input.employeeId ? sql`AND r.employee_id=${input.employeeId}` : sql``} ${input.status ? sql`AND r.status=${input.status}` : sql``}`;
  const data = await db.execute(sql`SELECT r.id,r.employee_id,r.action,r.status,r.version,r.created_at,
    employees.first_name || ' ' || employees.last_name AS employee_name FROM employment_period_requests r
    JOIN employees ON employees.id=r.employee_id WHERE ${where} ORDER BY r.id DESC LIMIT 25 OFFSET ${(input.page - 1) * 25}`);
  const total = await db.execute(sql`SELECT count(*)::integer AS total FROM employment_period_requests r JOIN employees ON employees.id=r.employee_id WHERE ${where}`);
  res.json({ items: data.rows, total: total.rows[0].total, page: input.page });
}));

router.post('/service/:employeeId/requests', handle(async (req, res) => {
  requireEmploymentWriter(req);
  const id = positiveId.parse(req.params.employeeId), input = servicePeriodRequestInput.parse(req.body);
  const result = await db.transaction(async tx => {
    const employee = await employmentEmployee(tx, req, id, true), policy = await employmentPolicy(tx);
    if (input.targetPeriodId) {
      const periods = await tx.execute(sql`SELECT * FROM employment_service_periods WHERE id=${input.targetPeriodId} AND employee_id=${id} FOR UPDATE`), period = periods.rows[0];
      if (!period || period.status !== 'active') fail(404, 'Active service period not found');
      employmentVersion(period, input.expectedPeriodVersion!);
    }
    if (input.period && input.action !== 'void') await validateServicePeriod(tx, employee, input.period, input.targetPeriodId);
    const saved = await tx.execute(sql`INSERT INTO employment_period_requests(employee_id,action,target_period_id,expected_period_version,period_data,policy_snapshot,reason,requested_by)
      VALUES (${id},${input.action},${input.targetPeriodId},${input.expectedPeriodVersion},${input.period ? JSON.stringify(input.period) : null}::jsonb,${JSON.stringify(policy)}::jsonb,${input.reason},${req.user.userId}) RETURNING *`);
    await recordHistory(tx, req, 'employment_period_request', saved.rows[0], input.reason);
    return saved.rows[0];
  });
  res.status(201).json(result);
}));

router.post('/period-requests/:id/actions', handle(async (req, res) => {
  requireEmploymentWriter(req);
  const id = positiveId.parse(req.params.id), input = periodActionInput.parse(req.body);
  const result = await db.transaction(async tx => {
    const found = await tx.execute(sql`SELECT employee_id FROM employment_period_requests WHERE id=${id}`);
    if (!found.rows.length) fail(404, 'Service request not found');
    const employee = await employmentEmployee(tx, req, Number(found.rows[0].employee_id), true);
    const requests = await tx.execute(sql`SELECT * FROM employment_period_requests WHERE id=${id} FOR UPDATE`), row = requests.rows[0] as ServicePeriodRequest;
    employmentVersion(row, input.version);
    if (row.status !== 'requested') fail(409, 'This service request is already closed');
    if (input.action === 'cancel') {
      if (row.requested_by !== req.user.userId && !employmentAdministrator(req.user.role)) fail(403, 'Only the preparer or an administrator can cancel this request');
    } else independentEmploymentReviewer(req, employee, row);
    if (input.action === 'approve') {
      if (row.target_period_id) {
        const periods = await tx.execute(sql`SELECT * FROM employment_service_periods WHERE id=${row.target_period_id} AND employee_id=${employee.id} FOR UPDATE`), period = periods.rows[0];
        if (!period || period.status !== 'active') fail(409, 'The original service period is no longer active');
        employmentVersion(period, row.expected_period_version!);
      }
      let saved: any;
      if (row.action === 'void') {
        saved = await tx.execute(sql`UPDATE employment_service_periods SET status='void',version=version+1,approved_by=${req.user.userId},updated_at=now() WHERE id=${row.target_period_id} RETURNING *`);
      } else {
        const period = row.period_data!;
        await validateServicePeriod(tx, employee, period, row.target_period_id);
        if (row.action === 'record') {
          saved = await tx.execute(sql`INSERT INTO employment_service_periods(employee_id,start_date,end_date,qualifies,service_type,note,source_reference,created_by,approved_by)
            VALUES (${employee.id},${period.startDate}::date,${period.endDate}::date,${period.qualifies},${period.serviceType},${period.note},${JSON.stringify({ requestId: row.id })}::jsonb,${row.requested_by},${req.user.userId}) RETURNING *`);
        } else {
          saved = await tx.execute(sql`UPDATE employment_service_periods SET start_date=${period.startDate}::date,end_date=${period.endDate}::date,qualifies=${period.qualifies},service_type=${period.serviceType},note=${period.note},source='reviewed',source_reference=${JSON.stringify({ requestId: row.id })}::jsonb,version=version+1,approved_by=${req.user.userId},updated_at=now() WHERE id=${row.target_period_id} RETURNING *`);
        }
      }
      await recordHistory(tx, req, 'employment_service_period', saved.rows[0], input.reason);
    }
    const result = await tx.execute(sql`UPDATE employment_period_requests SET status=${input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'cancelled'},reviewed_by=${input.action === 'cancel' ? null : req.user.userId},decision_reason=${input.reason},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`);
    await recordHistory(tx, req, 'employment_period_request', result.rows[0], input.reason);
    return result.rows[0];
  });
  res.json(result);
}));
router.get('/service/:employeeId/history', handle(async (req, res) => {
  const employee = await employmentEmployee(db, req, positiveId.parse(req.params.employeeId)), page = pageInput.parse(req.query).page;
  const rows = await db.execute(sql`SELECT h.kind,h.record_id,h.version,h.reason,h.actor_id,h.created_at,h.snapshot FROM hr_workflow_history h
    WHERE (h.kind='employment_service_period' AND EXISTS (SELECT 1 FROM employment_service_periods p WHERE p.id=h.record_id AND p.employee_id=${employee.id}))
       OR (h.kind='employment_period_request' AND EXISTS (SELECT 1 FROM employment_period_requests p WHERE p.id=h.record_id AND p.employee_id=${employee.id}))
    ORDER BY h.created_at DESC,h.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`);
  res.json({ items: rows.rows, page, hasMore: rows.rows.length === 50 });
}));

export default router;
