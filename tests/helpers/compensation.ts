import { sql } from 'drizzle-orm';
import { emptyCompensation } from '../../shared/compensation';

/** Explicit synthetic prerequisite for onboarding completion tests. */
export async function seedCompensation(db: any, employeeId: number, actorId: number, date = '2020-01-01') {
  const definition = emptyCompensation(); definition.items[0].amount = '1000.00';
  await db.execute(sql`INSERT INTO employee_compensation_packages(employee_id,version,effective_from,definition,reason,created_by)
    VALUES (${employeeId},1,${date}::date,${JSON.stringify(definition)}::jsonb,'Synthetic onboarding prerequisite',${actorId})`);
}
