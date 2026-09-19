import { eq } from 'drizzle-orm';
import { db } from '../db';
import { appSettings } from '@shared/schema';
import { workspaceInput, type WorkspaceRecord } from '@shared/helpdesk-workspace';
import { reject, type HelpdeskTransaction } from './helpdesk';

export const workspaceKey = 'helpdesk_workspace';
export async function helpdeskWorkspace(tx: HelpdeskTransaction | typeof db, lock = false): Promise<WorkspaceRecord> {
  const query = tx.select().from(appSettings).where(eq(appSettings.key, workspaceKey));
  const [row] = lock ? await query.for('update') : await query;
  const value = row?.value as WorkspaceRecord | undefined;
  const parsed = workspaceInput.safeParse(value?.workspace);
  if (!parsed.success || !Number.isInteger(value?.version) || !value || value.version < 1)
    return reject(503, 'Helpdesk configuration is unavailable. An administrator must apply the helpdesk workspace migration.');
  return {version: value.version, workspace: parsed.data};
}
export async function requireCategory(tx: HelpdeskTransaction, id: string, allowDisabled = false) {
  const {workspace} = await helpdeskWorkspace(tx);
  const category = workspace.categories.find(c => c.id === id);
  if (!category || (!allowDisabled && !category.enabled)) return reject(400, 'Choose an enabled helpdesk category');
  return category;
}
