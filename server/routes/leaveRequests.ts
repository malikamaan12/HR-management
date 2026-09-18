import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, gte, lte, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { employees, leaves, leaveLedger, leaveSnapshots, hrRules,attendance } from '@shared/schema';
import { employeeScope } from '../services/access';
import { authenticate } from '../middleware/auth';
import { handle } from './hr-rules';
import { civilDate, positiveId, reason } from '@shared/hr-rules';
import { accrue, balance, reserved, leavePlan, assertFunds, employeeBalances } from '../services/leave-ledger';
import { scopedEmployee, audit, isRuleAdmin, businessToday } from '../services/hr-rules';
import { fail, assertLeaveCompatible } from '../services/workforce';
import { hasPermission } from '@shared/permissions';
import { calculationSnapshot } from '../services/calculation-rules';
import {leaveApprovalChain,halfDayWindow,leaveOverlaps} from '@shared/leave-workflow';
import {validateLeaveApprovers,decideLeaveStage} from '../services/leave-workflow';
import {recordHistory} from '../services/workflowRecords';
const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/options', handle(async (req, res) => {
    const people = await db.select({ id: employees.id, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, own: sql<boolean> `${employees.userId}=${req.user!.userId}` }).from(employees).where(employeeScope(req.user!, 'leave_absence_management')).orderBy(employees.id).limit(1000);
    const types = await db.selectDistinct({ name: hrRules.name }).from(hrRules).where(eq(hrRules.kind, 'leave'));
    res.json({ employees: people, types: types.map(t => t.name), canConfigure: isRuleAdmin(req.user!) });
}));
router.get('/balances/:employeeId/:year', handle(async (req, res) => {
    const id = positiveId.parse(req.params.employeeId), year = z.coerce.number().int().min(2000).max(2200).parse(req.params.year);
    res.json(await db.transaction(async (tx) => { const employee = await scopedEmployee(tx, req.user!, id, 'leave_absence_management', 'read', true); const result = await employeeBalances(tx, employee, year); const history = await tx.select().from(leaveLedger).where(and(eq(leaveLedger.employeeId, id), eq(leaveLedger.year, year))).orderBy(desc(leaveLedger.id)); return { balances: result, history }; }));
}));
router.post('/adjustment', handle(async (req, res) => {
    if (!isRuleAdmin(req.user!))
        fail(403, 'Administrator access required');
    const input = z.object({ employeeId: positiveId, leaveType: z.string().trim().min(1).max(100), year: z.number().int().min(2000).max(2200), days: z.number().min(-366).max(366).multipleOf(0.01), reason, key: z.string().uuid() }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => { const e = await scopedEmployee(tx, req.user!, input.employeeId, 'leave_absence_management', 'update', true); if (e.userId === req.user!.userId)
        fail(403, 'Another administrator must adjust your balance'); const [existing] = await tx.select().from(leaveLedger).where(eq(leaveLedger.sourceKey, 'adjustment:' + input.key)); if (existing)
        return existing; if (input.year < Number(businessToday().slice(0, 4)))
        fail(409, 'Adjust the current year to reconcile closed-year balances'); await accrue(tx, e, input.leaveType, input.year); if (await balance(tx, e.id, input.leaveType, input.year) + Math.round(input.days * 100) < await reserved(tx, e.id, input.leaveType, input.year))
        fail(409, 'Adjustment would overdraw the balance'); const [row] = await tx.insert(leaveLedger).values({ employeeId: e.id, leaveType: input.leaveType, year: input.year, units: Math.round(input.days * 100), sourceKey: 'adjustment:' + input.key, reason: input.reason, actorId: req.user!.userId }).returning(); await audit(tx, req.user!, 'leave_ledger', row.id, 'Balance adjustment recorded'); return row; }));
}));
router.post('/preview', handle(async (req, res) => { const input = z.object({ employeeId: positiveId, leaveType: z.string().min(1), startDate: civilDate, endDate: civilDate,dayPortion:z.enum(['full','first_half','second_half']).default('full') }).strict().parse(req.body); res.json(await db.transaction(async (tx) => { const e = await scopedEmployee(tx, req.user!, input.employeeId, 'leave_absence_management'); return leavePlan(tx, e, input.leaveType, input.startDate, input.endDate,input.dayPortion); })); }));
router.post('/', handle(async (req, res) => {
    const input = z.object({ employeeId: positiveId, leaveType: z.string().trim().min(1).max(100), startDate: civilDate, endDate: civilDate,dayPortion:z.enum(['full','first_half','second_half']).default('full'), reason }).strict().parse(req.body);
    const result = await db.transaction(async (tx) => {
      const e = await scopedEmployee(tx, req.user!, input.employeeId, 'leave_absence_management', 'create', true);
      if (input.startDate.slice(0,4)<businessToday().slice(0,4))fail(400,'Use a balance adjustment for closed-year reconciliation');
      const plan=await leavePlan(tx,e,input.leaveType,input.startDate,input.endDate,input.dayPortion),window=halfDayWindow(plan);
      const overlaps=await tx.select({leave:leaves,snapshot:leaveSnapshots}).from(leaves).leftJoin(leaveSnapshots,eq(leaveSnapshots.leaveId,leaves.id)).where(and(eq(leaves.employeeId,e.id),inArray(leaves.status,['pending','approved']),lte(leaves.startDate,input.endDate),gte(leaves.endDate,input.startDate)));
      if(overlaps.some(r=>{const previous=halfDayWindow(r.snapshot);return !window||!previous||+window.start<+previous.end&&+window.end>+previous.start;}))fail(409,'This period overlaps an existing leave request');
      await validateLeaveApprovers(tx,e,plan.approvalChain);await assertFunds(tx,e,input.leaveType,plan);
      const {dayPortion,...fields}=input;
      const [leave]=await tx.insert(leaves).values({...fields,totalDays:plan.totalDays,calculationSnapshot:await calculationSnapshot(e,input.startDate,tx),status:'pending'}).returning();
      const {totalDays,...snapshot}=plan;await tx.insert(leaveSnapshots).values({leaveId:leave.id,...snapshot});
      await recordHistory(tx,req,'leave_request',{...leave,version:leave.reviewVersion},'Submitted leave with saved rules and approval stages');return leave;
    });
    res.status(201).json(result);
}));
router.get(['/', '/pending', '/status/:status'], handle(async (req, res) => {
    const status = req.path === '/pending' ? 'pending' : req.params.status ? z.enum(['pending', 'approved', 'rejected', 'cancelled']).parse(req.params.status) : undefined;
    const rows = await db.select({ leave: leaves, employee: { id: employees.id, firstName: employees.firstName, lastName: employees.lastName, department: employees.department, position: employees.position }, owner: employees.userId, snapshot: leaveSnapshots }).from(leaves).innerJoin(employees, eq(leaves.employeeId, employees.id)).leftJoin(leaveSnapshots, eq(leaves.id, leaveSnapshots.leaveId)).where(and(employeeScope(req.user!, 'leave_absence_management'), status ? eq(leaves.status, status) : undefined)).orderBy(desc(leaves.createdAt)).limit(1000);
    res.json(rows.map(({ leave, employee, owner, snapshot }) => {const chain=leaveApprovalChain(snapshot),current=chain[Math.min(leave.approvalStage,chain.length-1)];return({ ...leave, employee, leaveType: { name: leave.leaveType }, snapshot,approvalStageCount:chain.length,dayPortion:snapshot?.dayPortion||'full', canDecide: hasPermission(req.user!.role, 'leave_absence_management', 'approve') && owner !== req.user!.userId && (!current || current === req.user!.userId)&&!chain.slice(leave.approvalStage+1).includes(req.user!.userId), canCancel: leave.status === 'pending' && (owner === req.user!.userId || hasPermission(req.user!.role, 'leave_absence_management', 'approve')) });}));
}));
router.get('/:id', handle(async (req, res) => { const [row] = await db.select({ leave: leaves, snapshot: leaveSnapshots }).from(leaves).innerJoin(employees, eq(leaves.employeeId, employees.id)).leftJoin(leaveSnapshots, eq(leaves.id, leaveSnapshots.leaveId)).where(and(eq(leaves.id, positiveId.parse(req.params.id)), employeeScope(req.user!, 'leave_absence_management'))); if (!row)
    fail(404, 'Leave request not found'); res.json({ ...row.leave, snapshot: row.snapshot }); }));
router.patch('/:id/status', handle(async (req, res) => {
    const id = positiveId.parse(req.params.id), input = z.object({ status: z.enum(['approved', 'rejected', 'cancelled']), version:positiveId.optional(),reason: reason.default('Leave decision recorded') }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => {
        const [initial] = await tx.select().from(leaves).where(eq(leaves.id, id));
        if (!initial)
            fail(404, 'Leave not found');
        const e = await scopedEmployee(tx, req.user!, initial.employeeId, 'leave_absence_management', input.status === 'cancelled' && initial.status === 'pending' ? 'read' : 'approve', true);
        if (input.status === 'cancelled' && initial.status === 'pending' && e.userId !== req.user!.userId && !hasPermission(req.user!.role, 'leave_absence_management', 'approve'))
            fail(403, 'Only the requester or an approver can cancel pending leave');
        const [row] = await tx.select().from(leaves).where(eq(leaves.id, id)).for('update');
        const [snapshot] = await tx.select().from(leaveSnapshots).where(eq(leaveSnapshots.leaveId, id));
        if(row.reviewVersion!==(input.version??1))fail(409,'Leave changed; reload before deciding');
        if (row.status !== 'pending' && !(row.status === 'approved' && input.status === 'cancelled'))
            fail(409, 'This request has already been decided');
        const chain=leaveApprovalChain(snapshot),current=chain[Math.min(row.approvalStage,chain.length-1)];
        if ((input.status !== 'cancelled' || row.status === 'approved') && (e.userId === req.user!.userId || current && current !== req.user!.userId))
            fail(403, 'An independent designated approver must decide this request');
        if (row.startDate.slice(0, 4) < businessToday().slice(0, 4))
            fail(409, 'Use a current-year adjustment for a closed-year request');
        if (input.status === 'approved') {
            if(e.status!=='active'||row.startDate<e.joiningDate||(e.contractEndDate&&row.endDate>e.contractEndDate)||(e.terminationDate&&row.endDate>e.terminationDate))fail(409,'Employment changed; cancel this request and reconcile the leave dates');
            if (!snapshot)
                fail(409, 'This legacy request needs to be cancelled and resubmitted with current rules');
            await assertFunds(tx, e, row.leaveType, snapshot, id);
            await validateLeaveApprovers(tx,e,chain.slice(row.approvalStage));
            await assertLeaveCompatible(tx, e.id, row.startDate, row.endDate,snapshot);
            const worked=await tx.select().from(attendance).where(and(eq(attendance.employeeId,e.id),gte(attendance.date,row.startDate),lte(attendance.date,row.endDate)));
            if(worked.some(r=>r.checkIn&&leaveOverlaps(snapshot,row.startDate,row.endDate,r.checkIn,r.checkOut||new Date(Math.max(+new Date(),+r.checkIn+86400000)),process.env.APP_TIMEZONE||'Asia/Qatar')))fail(409,'Recorded attendance overlaps leave; resolve the worked time before approval');
            const lastStage=await decideLeaveStage(tx,req.user!.userId,row,snapshot,'approved',input.reason);
            if(!lastStage){const [advanced]=await tx.update(leaves).set({approvalStage:row.approvalStage+1,reviewVersion:row.reviewVersion+1,updatedAt:new Date()}).where(eq(leaves.id,id)).returning();await recordHistory(tx,req,'leave_request',{...advanced,version:advanced.reviewVersion},`Stage ${row.approvalStage+1} approved: ${input.reason}`);return advanced;}
            if (snapshot.balanceRequired)
                for (const [year, days] of Object.entries(snapshot.daysByYear))
                    await tx.insert(leaveLedger).values({ employeeId: e.id, leaveType: row.leaveType, year: Number(year), units: -days * 100, sourceKey: `leave:${id}:${year}:debit`, reason: input.reason, actorId: req.user!.userId });
        }
        if (row.status === 'approved' && snapshot?.balanceRequired)
            for (const [year, days] of Object.entries(snapshot.daysByYear))
                await tx.insert(leaveLedger).values({ employeeId: e.id, leaveType: row.leaveType, year: Number(year), units: days * 100, sourceKey: `leave:${id}:${year}:refund`, reason: input.reason, actorId: req.user!.userId });
        if(input.status==='rejected')await decideLeaveStage(tx,req.user!.userId,row,snapshot,'rejected',input.reason);
        const [updated] = await tx.update(leaves).set({ status: input.status,reviewVersion:row.reviewVersion+1, approvedBy: req.user!.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(leaves.id, id)).returning();
        await recordHistory(tx,req,'leave_request',{...updated,version:updated.reviewVersion},`${input.status}: ${input.reason}`);
        return updated;
    }));
}));
router.get('/:id/history',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset);
 const [row]=await db.select({id:leaves.id}).from(leaves).innerJoin(employees,eq(employees.id,leaves.employeeId)).where(and(eq(leaves.id,id),employeeScope(req.user!,'leave_absence_management')));
 if(!row)fail(404,'Leave request not found');
 const history=await db.execute(sql`SELECT version,reason,created_at,snapshot->>'status' AS status,snapshot->>'approvalStage' AS stage FROM hr_workflow_history WHERE kind='leave_request' AND record_id=${id} ORDER BY version DESC LIMIT 26 OFFSET ${offset}`);
 const stages=await db.execute(sql`SELECT stage,decision,reason,created_at FROM hr_leave_stage_decisions WHERE leave_id=${id} ORDER BY stage`);
 res.json({items:history.rows.slice(0,25),hasMore:history.rows.length>25,stages:stages.rows});
}));
export default router;
