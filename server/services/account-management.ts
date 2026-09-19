import { and, eq, ne, sql } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db';
import { users, employees, authSessions, securityLogs, userRoleEnum } from '@shared/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const accountFields = { id: users.id, username: users.username, email: users.email, firstName: users.firstName,
  lastName: users.lastName, role: users.role, department: users.department, isActive: users.isActive,
  approvalStatus: users.approvalStatus, accountState: users.accountState, accountVersion: users.accountVersion,
  passwordSetupRequired: users.passwordSetupRequired, lastLogin: users.lastLogin, createdAt: users.createdAt };
export const accountPatch = z.object({
  username: z.string().trim().min(3).max(254).optional(), email: z.string().trim().email().max(254).optional(),
  role: z.enum(userRoleEnum.enumValues).optional(), department: z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(), accountState: z.enum(['active','frozen','on_hold','revoked','deleted']).optional(),
  accountVersion: z.number().int().positive().optional(), reason: z.string().trim().min(3).max(500).default('Administrator account update'),
}).strict();
export async function accountActor(tx: Tx, actorId: number) {
  // Serialize account administration, including bulk provisioning and last-admin checks.
  await tx.execute(sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`);
  const [actor] = await tx.select().from(users).where(eq(users.id, actorId));
  if (!actor || !actor.isActive || actor.approvalStatus !== 'approved' || actor.accountState !== 'active' || actor.passwordSetupRequired || !['admin','super_admin'].includes(actor.role)) throw new Error('Active administrator access is required');
  return actor;
}
export async function accountTarget(tx: Tx, actor: typeof users.$inferSelect, id: number, version?: number) {
  if (id === actor.id) throw new Error('Use My account for your own details; you cannot change your own administrative access');
  const [target] = await tx.select().from(users).where(eq(users.id, id)).for('update');
  if (!target) throw new Error('Account not found');
  if (target.role === 'super_admin' && actor.role !== 'super_admin') throw new Error('Super administrator access is required');
  if (version !== undefined && version !== target.accountVersion) throw new Error('This account changed. Refresh and try again');
  if (target.accountState === 'deleted') throw new Error('Deleted accounts cannot be modified');
  return target;
}
export async function auditAccount(tx: Tx, actorId: number, id: number, action: string, reason: string, metadata: Record<string, unknown> = {}) {
  await tx.insert(securityLogs).values({ userId: actorId, eventType: 'data_access', resourceType: 'account', resourceId: String(id),
    description: action, metadata: { ...metadata, reason }, severity: 'info' });
}
export async function invalidateAccount(tx: Tx, id: number) {
  await tx.update(authSessions).set({ isActive: false }).where(eq(authSessions.userId, id));
}
export function setupSecret() {
  const token = randomBytes(32).toString('hex');
  return { token, hash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
}
async function uniqueIdentity(tx: Tx, username: string, email: string, id = 0) {
  const [collision] = await tx.select({ id: users.id }).from(users).where(and(ne(users.id, id), sql`(lower(${users.username}) = lower(${username}) OR lower(${users.email}) = lower(${email}))`));
  if (collision) throw new Error('Username or email is already used by an account; link the existing account after verifying identity');
}
export async function updateAccount(actorId: number, id: number, data: z.input<typeof accountPatch>) {
  const input = accountPatch.parse(data);
  return db.transaction(async tx => {
    const actor = await accountActor(tx, actorId), target = await accountTarget(tx, actor, id, input.accountVersion);
    if (input.role === 'super_admin' && actor.role !== 'super_admin') throw new Error('Super administrator access is required');
    if (input.accountState && input.isActive !== undefined) throw new Error('Choose one account status');
    const state = input.accountState ?? (input.isActive === undefined ? target.accountState : input.isActive ? 'active' : 'on_hold');
    const username = input.username ?? target.username, email = input.email ?? target.email;
    await uniqueIdentity(tx, username, email, id);
    const [updated] = await tx.update(users).set({ username, email, role: input.role ?? target.role,
      department: input.department ?? target.department, accountState: state, isActive: state === 'active' && target.approvalStatus === 'approved',
      isEmailVerified: email === target.email ? target.isEmailVerified : false,
      passwordResetToken: null, passwordResetExpires: null, refreshToken: null,
      accountVersion: target.accountVersion + 1, updatedAt: new Date(),
    }).where(eq(users.id, id)).returning(accountFields);
    await invalidateAccount(tx, id);
    await auditAccount(tx, actorId, id, state === 'deleted' ? 'Account deleted (HR records retained)' : 'Account updated; sessions revoked', input.reason,
      { before: { username: target.username, email: target.email, role: target.role, state: target.accountState }, after: { username, email, role: updated.role, state } });
    return updated;
  });
}
export async function provisionEmployees(actorId: number, employeeIds: number[], preview: boolean, versions: Record<string, number> = {}) {
  // Unknown random passwords cannot be shared or guessed; employees choose their own through a one-use link.
  const password = preview ? '' : await bcrypt.hash(randomBytes(48).toString('hex'), 12);
  return db.transaction(async tx => {
    await accountActor(tx, actorId);
    const result = [];
    for (const id of [...new Set(employeeIds)].sort((a,b) => a-b)) {
      const [employee] = await tx.select().from(employees).where(eq(employees.id, id)).for('update');
      if (!employee) throw new Error('Employee not found');
      if (employee.status !== 'active') throw new Error('Only active employees can receive a new account');
      if (employee.userId) { result.push({ employeeId: id, employeeRef: employee.employeeId, status: 'already_linked' as const }); continue; }
      if (!preview && versions[String(id)] !== employee.recordVersion) throw new Error('Employee records changed or review is missing. Review the batch again');
      const email = z.string().email().max(254).parse(employee.workEmail?.trim().toLowerCase());
      await uniqueIdentity(tx, email, email);
      if (result.some(row => 'email' in row && row.email === email)) throw new Error('Two selected employees share a work email');
      const role = employee.type === 'permanent' ? 'permanent_employee' : employee.type === 'temporary' ? 'temporary_staff' : 'employee';
      const row = { employeeId: id, recordVersion: employee.recordVersion, employeeRef: employee.employeeId, name: `${employee.firstName} ${employee.lastName}`, email, username: email, role };
      if (preview) { result.push({ ...row, status: 'ready' as const }); continue; }
      const secret = setupSecret();
      const [account] = await tx.insert(users).values({ username: email, email, firstName: employee.firstName, lastName: employee.lastName,
        department: employee.department, role, password, isActive: true, approvalStatus: 'approved', approvedBy: actorId, approvedAt: new Date(),
        passwordSetupRequired: true, passwordResetToken: secret.hash, passwordResetExpires: secret.expiresAt }).returning({ id: users.id });
      await tx.update(employees).set({ userId: account.id, recordVersion: employee.recordVersion + 1, updatedAt: new Date() }).where(eq(employees.id, id));
      await auditAccount(tx, actorId, account.id, 'Employee account created and linked', 'Employee account provisioning', { employeeId: id, role });
      result.push({ ...row, status: 'created' as const, accountId: account.id, setupToken: secret.token, expiresAt: secret.expiresAt });
    }
    return result;
  });
}
