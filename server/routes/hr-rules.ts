import { Router } from 'express';
import { and, eq, ilike, or, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { hrRules, employees, users } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { isRuleAdmin, saveRule } from '../services/hr-rules';
import { fail, WorkforceError } from '../services/workforce';
import { z } from 'zod';
import type { Request, Response } from 'express';
export const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => { try {
    await fn(req, res);
}
catch (e) {
    res.status(e instanceof WorkforceError ? e.status : e instanceof z.ZodError ? 400 : 500).json({ message: e instanceof WorkforceError ? e.message : e instanceof z.ZodError ? e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Unable to complete the request' });
} };
const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', handle(async (req, res) => { if (!isRuleAdmin(req.user!))
    fail(403, 'Administrator access required'); res.json(await db.select({ rule: hrRules, employeeName: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}` }).from(hrRules).leftJoin(employees, eq(hrRules.employeeId, employees.id)).orderBy(desc(hrRules.id)).limit(500)); }));
router.post('/', handle(async (req, res) => res.status(201).json(await saveRule(req.user!, req.body))));
router.get('/directory', handle(async (req, res) => {
    if (!isRuleAdmin(req.user!))
        fail(403, 'Administrator access required');
    const q = z.string().max(100).parse(req.query.q || '');
    const term = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    res.json({ employees: await db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, employeeId: employees.employeeId }).from(employees).where(or(ilike(employees.firstName, term), ilike(employees.lastName, term), ilike(employees.employeeId, term))).orderBy(employees.id).limit(50), approvers: await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role }).from(users).where(and(eq(users.isActive, true), eq(users.approvalStatus, 'approved'))).orderBy(users.id).limit(500) });
}));
export default router;
