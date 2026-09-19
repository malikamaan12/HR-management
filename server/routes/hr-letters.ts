import { Router } from 'express';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { users } from '@shared/schema';
import { positiveId, reason } from '@shared/hr-rules';
import { letterTemplateCreate, letterDefinition, letterRequestInput, letterCorrection, letterAction, letterStatuses, letterManagers, letterPublishers } from '@shared/hr-letters';
import { authenticate } from '../middleware/auth';
import { WorkflowError, recordHandler, recordHistory } from '../services/workflowRecords';
import { letterScope, managerScope, requireLetterPublisher, letterVersion, letterEmployee, requireActiveLetterEmployee, publishedLetterTemplate, letterRecord, letterActions, prepareLetterSnapshot, printableLetter } from '../services/hr-letters';

const router = Router(), offset = z.coerce.number().int().min(0).max(1000000).default(0);
const search = z.string().trim().max(100).default('');
const term = (value: string) => '%' + value.replace(/[\\%_]/g, '\\$&') + '%';
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/context', recordHandler(async (req, res) => {
  res.json({ canManage: letterManagers(req.user.role), canPublish: letterPublishers(req.user.role) });
}));
router.get('/employees', recordHandler(async (req, res) => {
  const query = z.object({ q: search, offset }).strict().parse(req.query), pattern = term(query.q);
  const rows = (await db.execute(sql`SELECT employees.id,employees.employee_id AS reference,employees.first_name || ' ' || employees.last_name AS name,employees.department,employees.type FROM employees WHERE ${letterScope(req.user)} AND employees.status<>'inactive' AND (employees.first_name || ' ' || employees.last_name || ' ' || employees.employee_id) ILIKE ${pattern} ORDER BY employees.first_name,employees.id LIMIT 26 OFFSET ${query.offset}`)).rows;
  res.json({ items: rows.slice(0, 25), hasMore: rows.length > 25 });
}));
router.get('/templates', recordHandler(async (req, res) => {
  const query = z.object({ q: search, offset, all: z.enum(['true', 'false']).default('false') }).strict().parse(req.query);
  const admin = letterPublishers(req.user.role), all = query.all === 'true';
  if (all) requireLetterPublisher(req.user);
  const rows = (await db.execute(sql`SELECT t.* FROM hr_letter_templates t WHERE (${all} OR t.status='published' AND NOT EXISTS(SELECT 1 FROM hr_letter_templates newer WHERE newer.code=t.code AND newer.status='published' AND newer.revision>t.revision)) AND (t.definition->>'name') ILIKE ${term(query.q)} ORDER BY t.id DESC LIMIT 26 OFFSET ${query.offset}`)).rows;
  res.json({ items: rows.slice(0, 25).map((row: any) => admin ? row : { id: row.id, code: row.code, revision: row.revision, name: row.definition.name, description: row.definition.description, employeeTypes: row.definition.employeeTypes }), hasMore: rows.length > 25 });
}));
router.post('/templates', recordHandler(async (req, res) => {
  requireLetterPublisher(req.user); const input = letterTemplateCreate.parse(req.body);
  res.status(201).json(await db.transaction(async tx => {
    await tx.execute(sql`LOCK TABLE hr_letter_templates IN SHARE ROW EXCLUSIVE MODE`);
    if ((await tx.execute(sql`SELECT id FROM hr_letter_templates WHERE code=${input.code} LIMIT 1`)).rows.length) throw new WorkflowError(409, 'This code already exists. Create a revision of that template.');
    const row = (await tx.execute(sql`INSERT INTO hr_letter_templates(code,revision,definition,created_by) VALUES(${input.code},1,${JSON.stringify(input.definition)}::jsonb,${req.user.userId}) RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'letter_template', row, input.reason); return row;
  }));
}));
router.patch('/templates/:id', recordHandler(async (req, res) => {
  requireLetterPublisher(req.user); const id = positiveId.parse(req.params.id), input = z.object({ version: positiveId, definition: letterDefinition, reason }).strict().parse(req.body);
  res.json(await db.transaction(async tx => {
    const old = (await tx.execute(sql`SELECT * FROM hr_letter_templates WHERE id=${id} FOR UPDATE`)).rows[0];
    if (!old) throw new WorkflowError(404, 'Template not found'); letterVersion(Number(old.version), input.version);
    if (old.status !== 'draft') throw new WorkflowError(409, 'Published content cannot be edited. Create a revision.');
    const row = (await tx.execute(sql`UPDATE hr_letter_templates SET definition=${JSON.stringify(input.definition)}::jsonb,version=version+1 WHERE id=${id} RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'letter_template', row, input.reason); return row;
  }));
}));
router.post('/templates/:id/:action', recordHandler(async (req, res) => {
  requireLetterPublisher(req.user); const id = positiveId.parse(req.params.id), action = z.enum(['publish', 'archive', 'revise']).parse(req.params.action), input = letterAction.parse(req.body);
  res.json(await db.transaction(async tx => {
    await tx.execute(sql`LOCK TABLE hr_letter_templates IN SHARE ROW EXCLUSIVE MODE`);
    const old = (await tx.execute(sql`SELECT * FROM hr_letter_templates WHERE id=${id} FOR UPDATE`)).rows[0];
    if (!old) throw new WorkflowError(404, 'Template not found'); letterVersion(Number(old.version), input.version);
    let row;
    if (action === 'revise') {
      const latest = (await tx.execute(sql`SELECT id,revision,status FROM hr_letter_templates WHERE code=${old.code} ORDER BY revision DESC LIMIT 1`)).rows[0];
      if (Number(latest.id) !== id || old.status === 'draft') throw new WorkflowError(409, 'Create a revision from the latest published or archived template');
      row = (await tx.execute(sql`INSERT INTO hr_letter_templates(code,revision,definition,created_by) VALUES(${old.code},${Number(old.revision) + 1},${JSON.stringify(old.definition)}::jsonb,${req.user.userId}) RETURNING *`)).rows[0];
    } else if (action === 'archive') {
      const latest = (await tx.execute(sql`SELECT id FROM hr_letter_templates WHERE code=${old.code} ORDER BY revision DESC LIMIT 1`)).rows[0];
      if (Number(latest.id) !== id) throw new WorkflowError(409, 'Open the latest revision to archive this template and all its revisions');
      const archived = (await tx.execute(sql`UPDATE hr_letter_templates SET status='archived',version=version+1 WHERE code=${old.code} AND status<>'archived' RETURNING *`)).rows;
      if (!archived.length) throw new WorkflowError(409, 'This template is already archived');
      for (const revision of archived) await recordHistory(tx, req, 'letter_template', revision, input.reason);
      return archived.find((revision: any) => Number(revision.id) === id);
    } else {
      if (old.status !== 'draft') throw new WorkflowError(409, 'Only a draft can be published');
      letterDefinition.parse(old.definition);
      row = (await tx.execute(sql`UPDATE hr_letter_templates SET status='published',published_by=${req.user.userId},published_at=now(),version=version+1 WHERE id=${id} RETURNING *`)).rows[0];
    }
    await recordHistory(tx, req, 'letter_template', row, input.reason); return row;
  }));
}));
router.get('/templates/:id/history', recordHandler(async (req, res) => {
  requireLetterPublisher(req.user); const id = positiveId.parse(req.params.id), start = offset.parse(req.query.offset);
  res.json((await db.execute(sql`SELECT version,reason,created_at,snapshot FROM hr_workflow_history WHERE kind='letter_template' AND record_id=${id} ORDER BY version DESC LIMIT 25 OFFSET ${start}`)).rows);
}));
router.get('/requests', recordHandler(async (req, res) => {
  const query = z.object({ q: search, offset, status: z.enum(['', ...letterStatuses]).default(''), view: z.enum(['mine', 'team']).default('mine') }).strict().parse(req.query);
  if (query.view === 'team' && !letterManagers(req.user.role)) throw new WorkflowError(403, 'HR access required');
  const scope = query.view === 'mine' ? sql`employees.user_id=${req.user.userId} OR (r.created_by=${req.user.userId} AND ${letterScope(req.user)})` : managerScope(req.user);
  const rows = (await db.execute(sql`SELECT r.id,r.reference,r.employee_id,r.template_id,r.status,r.version,r.recipient,r.created_at,employees.first_name || ' ' || employees.last_name AS employee_name,t.definition->>'name' AS template_name FROM hr_letter_requests r JOIN employees ON employees.id=r.employee_id JOIN hr_letter_templates t ON t.id=r.template_id WHERE (${scope}) AND (${query.status === ''} OR r.status=${query.status}) AND (r.reference ILIKE ${term(query.q)} OR (employees.first_name || ' ' || employees.last_name) ILIKE ${term(query.q)}) ORDER BY r.id DESC LIMIT 26 OFFSET ${query.offset}`)).rows;
  res.json({ items: rows.slice(0, 25), hasMore: rows.length > 25 });
}));
router.post('/requests', recordHandler(async (req, res) => {
  const input = letterRequestInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx => {
    const employee = await letterEmployee(tx, req.user, input.employeeId, false, true); requireActiveLetterEmployee(employee);
    await publishedLetterTemplate(tx, input.templateId, employee);
    const existing = (await tx.execute(sql`SELECT * FROM hr_letter_requests WHERE created_by=${req.user.userId} AND submission_key=${input.submissionKey}`)).rows[0];
    if (existing) {
      if (Number(existing.employee_id) !== input.employeeId || Number(existing.template_id) !== input.templateId || existing.recipient !== input.recipient || existing.purpose !== input.purpose) throw new WorkflowError(409, 'This submission key was used for different request details');
      return existing;
    }
    const reference = 'HRL-' + randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
    const row = (await tx.execute(sql`INSERT INTO hr_letter_requests(reference,employee_id,template_id,recipient,purpose,submission_key,created_by) VALUES(${reference},${input.employeeId},${input.templateId},${input.recipient},${input.purpose},${input.submissionKey},${req.user.userId}) RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'letter_request', row, 'Requested letter: ' + input.purpose); return row;
  }));
}));
router.get('/requests/:id', recordHandler(async (req, res) => res.json(await db.transaction(async tx => {
  const { row, employee } = await letterRecord(tx, req.user, positiveId.parse(req.params.id));
  const history = (await tx.execute(sql`SELECT version,reason,created_at,snapshot->>'status' AS status FROM hr_workflow_history WHERE kind='letter_request' AND record_id=${row.id} ORDER BY version DESC LIMIT 50`)).rows;
  return { row, actions: letterActions(req.user, row, employee), history };
}))));
router.patch('/requests/:id', recordHandler(async (req, res) => {
  const input = letterCorrection.parse(req.body);
  res.json(await db.transaction(async tx => {
    const { row, employee } = await letterRecord(tx, req.user, positiveId.parse(req.params.id), true); letterVersion(Number(row.version), input.version);
    if (!letterActions(req.user, row, employee).correct) throw new WorkflowError(403, 'Only the employee or requester can correct a returned request');
    requireActiveLetterEmployee(employee); await publishedLetterTemplate(tx, input.templateId, employee);
    const saved = (await tx.execute(sql`UPDATE hr_letter_requests SET template_id=${input.templateId},recipient=${input.recipient},purpose=${input.purpose},status='requested',snapshot=NULL,prepared_by=NULL,prepared_at=NULL,version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'letter_request', saved, 'Corrected and resubmitted: ' + input.purpose); return saved;
  }));
}));
router.post('/requests/:id/:action', recordHandler(async (req, res) => {
  const action = z.enum(['prepare', 'issue', 'return', 'reject', 'cancel', 'revoke']).parse(req.params.action), input = letterAction.parse(req.body);
  res.json(await db.transaction(async tx => {
    const { row, employee } = await letterRecord(tx, req.user, positiveId.parse(req.params.id), true); letterVersion(Number(row.version), input.version);
    if (!letterActions(req.user, row, employee)[action]) throw new WorkflowError(403, 'This action needs an authorized independent reviewer or is unavailable in the current state');
    let saved;
    if (action === 'prepare') {
      requireActiveLetterEmployee(employee);
      const snapshot = await prepareLetterSnapshot(tx, req.user, row, employee);
      saved = (await tx.execute(sql`UPDATE hr_letter_requests SET snapshot=${JSON.stringify(snapshot)}::jsonb,status='prepared',prepared_by=${req.user.userId},prepared_at=now(),version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    } else if (action === 'issue') {
      if (input.confirmed !== true) throw new WorkflowError(400, 'Confirm that you reviewed this exact prepared letter');
      requireActiveLetterEmployee(employee);
      const current = await prepareLetterSnapshot(tx, req.user, row, employee);
      if (current.sourceHash !== (row.snapshot as any)?.sourceHash) throw new WorkflowError(409, 'Source details or letter date changed. Ask HR to prepare a fresh review copy.');
      const [reviewer] = await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, req.user.userId));
      saved = (await tx.execute(sql`UPDATE hr_letter_requests SET status='issued',issued_by=${req.user.userId},issued_by_name=${reviewer.firstName + ' ' + reviewer.lastName},issued_at=now(),version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    } else if (action === 'revoke') {
      if (input.confirmed !== true) throw new WorkflowError(400, 'Confirm revocation; previously downloaded copies cannot be recalled');
      saved = (await tx.execute(sql`UPDATE hr_letter_requests SET status='revoked',revoked_by=${req.user.userId},revoked_at=now(),version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    } else {
      const status = { return: 'returned', reject: 'rejected', cancel: 'cancelled' }[action];
      saved = (await tx.execute(sql`UPDATE hr_letter_requests SET status=${status},version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    }
    await recordHistory(tx, req, 'letter_request', saved, input.reason); return saved;
  }));
}));
router.get('/requests/:id/print', recordHandler(async (req, res) => {
  const { row } = await db.transaction(tx => letterRecord(tx, req.user, positiveId.parse(req.params.id)));
  if (row.status !== 'issued') throw new WorkflowError(409, 'Only a currently issued letter can be printed');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  res.set('X-Content-Type-Options', 'nosniff');
  res.type('html').send(printableLetter(row));
}));
export default router;
