import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { hrRules, users } from '@shared/schema';
import { compensationManagers, compensationRevisionInput, compensationPayrollInput, compensationTotals } from '@shared/compensation';
import { civilDate, positiveId, payrollRule } from '@shared/hr-rules';
import { moneyCents, moneyText } from '@shared/money';
import { authenticate } from '../middleware/auth';
import { handle } from './hr-rules';
import { audit, businessToday, isRuleAdmin, ruleFor } from '../services/hr-rules';
import { approver } from '../services/employee-services';
import { compensationEmployee, effectiveCompensation, packageRow } from '../services/compensation';
import { fail } from '../services/workforce';
import { hasPermission } from '@shared/permissions';

const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/employees/:employeeId', handle(async (req, res) => {
  const employeeId = positiveId.parse(req.params.employeeId), date = civilDate.parse(req.query.date || businessToday());
  res.json(await db.transaction(async tx => {
    const employee = await compensationEmployee(tx, req.user!, employeeId);
    const revisions = await tx.execute(sql`SELECT * FROM employee_compensation_packages WHERE employee_id=${employeeId} ORDER BY version DESC LIMIT 100`);
    const items = revisions.rows.map(packageRow), current = await effectiveCompensation(tx, employeeId, date);
    const links = await tx.execute(sql`SELECT l.package_id AS "packageId",l.rule_id AS "ruleId",l.created_at AS "createdAt" FROM employee_compensation_payroll_links l JOIN employee_compensation_packages p ON p.id=l.package_id WHERE p.employee_id=${employeeId} ORDER BY l.id DESC LIMIT 100`);
    const canSyncPayroll = isRuleAdmin(req.user!);
    res.set('Cache-Control', 'private, no-store');
    return { employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}`, joiningDate: employee.joiningDate, type: employee.type }, current, items, date, latestVersion: items[0]?.version || 0, totals: current ? compensationTotals(current.definition) : null, links: links.rows, canManage: compensationManagers(req.user!.role), canSyncPayroll,
      payrollPolicy: canSyncPayroll ? await ruleFor(tx, employeeId, 'payroll', 'Pay policy', date) || null : null,
      approvers: canSyncPayroll ? (await tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role }).from(users).where(and(eq(users.isActive, true), eq(users.approvalStatus, 'approved'))).orderBy(users.id).limit(1000)).filter(user => user.id !== employee.userId && hasPermission(user.role, 'payroll_management', 'approve')) : [],
    };
  }));
}));

router.post('/employees/:employeeId', handle(async (req, res) => {
  const employeeId = positiveId.parse(req.params.employeeId), input = compensationRevisionInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx => {
    const employee = await compensationEmployee(tx, req.user!, employeeId, true);
    if (input.effectiveFrom < employee.joiningDate) fail(400, 'A package cannot start before the employee joining date');
    const latest = await tx.execute(sql`SELECT COALESCE(MAX(version),0)::int AS version FROM employee_compensation_packages WHERE employee_id=${employeeId}`);
    const version = Number(latest.rows[0].version);
    if (version !== input.expectedVersion) fail(409, 'Compensation changed. Reload before saving a new revision');
    const definition = { ...input.definition, items: input.definition.items.map(item => ({ ...item, amount: moneyText(moneyCents(item.amount)) })) };
    const result = await tx.execute(sql`INSERT INTO employee_compensation_packages(employee_id,version,effective_from,definition,reason,created_by) VALUES(${employeeId},${version + 1},${input.effectiveFrom}::date,${JSON.stringify(definition)}::jsonb,${input.reason},${req.user!.userId}) RETURNING *`);
    const row = packageRow(result.rows[0]);
    await audit(tx, req.user!, 'employee_compensation', employeeId, `Compensation revision ${row.version} recorded, effective ${row.effectiveFrom}`);
    return row;
  }));
}));

router.post('/employees/:employeeId/packages/:packageId/payroll-rule', handle(async (req, res) => {
  if (!isRuleAdmin(req.user!)) fail(403, 'Only administrators can publish payroll calculation rules');
  const employeeId = positiveId.parse(req.params.employeeId), packageId = positiveId.parse(req.params.packageId), input = compensationPayrollInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx => {
    const employee = await compensationEmployee(tx, req.user!, employeeId, true);
    // Match saveRule's employee lock, and serialize company-rule publication as well.
    await tx.execute(sql`LOCK TABLE hr_rules IN SHARE ROW EXCLUSIVE MODE`);
    const result = await tx.execute(sql`SELECT * FROM employee_compensation_packages WHERE id=${packageId} AND employee_id=${employeeId}`);
    if (!result.rows[0]) fail(404, 'Compensation package not found');
    const row = packageRow(result.rows[0]);
    if (row.version !== input.expectedVersion) fail(409, 'The selected package changed. Reload before publishing');
    const effective = await effectiveCompensation(tx, employeeId, row.effectiveFrom);
    if (effective?.id !== row.id) fail(409, 'Use the latest package effective on this date');
    const linked = await tx.execute(sql`SELECT rule_id FROM employee_compensation_payroll_links WHERE package_id=${packageId}`);
    if (linked.rows.length) fail(409, 'This package already published a payroll rule. Create a new package revision for changes');
    const previous = await ruleFor(tx, employeeId, 'payroll', 'Pay policy', row.effectiveFrom);
    if ((previous?.id || null) !== input.expectedRuleId) fail(409, 'The effective payroll rule changed. Reload and review it before publishing');
    const base = row.definition.items.find(item => item.category === 'base')!;
    if (base.provision !== 'cash' || !['monthly', 'hourly'].includes(base.frequency)) fail(400, 'Payroll mapping requires monthly or hourly cash base pay. Daily and per-event pay remain recorded in the package');
    const allowances = Object.fromEntries(row.definition.items.filter(item => item.category !== 'base' && item.provision === 'cash' && item.frequency === 'monthly').map(item => [item.label, item.amount]));
    const previousConfig = previous ? payrollRule.parse(previous.config) : null;
    if (previousConfig && previousConfig.currency !== row.definition.currency && Object.values(previousConfig.deductions).some(value => moneyCents(value) > 0)) fail(409, 'Resolve deductions in the previous currency before publishing a package in another currency');
    const config = payrollRule.parse({ currency: row.definition.currency, cycleStartDay: input.cycleStartDay, payDay: input.payDay, basis: base.frequency === 'hourly' ? 'hourly' : 'salary', basicSalary: base.frequency === 'monthly' ? base.amount : '0.00', hourlyRate: base.frequency === 'hourly' ? base.amount : input.hourlyRate, regularMinutesPerDay: input.regularMinutesPerDay, overtimeMultiplier: input.overtimeMultiplier, allowances, deductions: previousConfig?.deductions || {}, approverId: input.approverId });
    await approver(tx, input.approverId, 'payroll_management', employee);
    const [rule] = await tx.insert(hrRules).values({ kind: 'payroll', employeeId, effectiveFrom: row.effectiveFrom, name: 'Pay policy', config, reason: input.reason, createdBy: req.user!.userId }).returning();
    await tx.execute(sql`INSERT INTO employee_compensation_payroll_links(package_id,rule_id,created_by,reason) VALUES(${packageId},${rule.id},${req.user!.userId},${input.reason})`);
    await audit(tx, req.user!, 'employee_compensation', employeeId, `Published payroll rule ${rule.id} from package revision ${row.version}; existing payroll records preserved`);
    return { ruleId: rule.id, effectiveFrom: row.effectiveFrom, config };
  }));
}));
export default router;
