import type { Request } from 'express';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { employees } from '@shared/schema';
import { hasPermission, getAccessScope, type HRModule, type Permission } from '@shared/permissions';

// This predicate belongs in the database query, before pagination or aggregation.
export function employeeScope(user: NonNullable<Request['user']>, module: HRModule, permission: Permission = 'read'): SQL {
  if(!hasPermission(user.role,module,permission))return sql`false`;
  switch(getAccessScope(user.role,module)){
    case 'all': return sql`true`;
    case 'self': return eq(employees.userId,user.userId);
    case 'department': return user.department ? eq(employees.department,user.department):sql`false`;
    case 'team': return or(eq(employees.userId,user.userId),eq(employees.reportingManagerId,sql`(select id from employees where user_id=${user.userId})`))!;
    case 'event_staff': return eq(employees.type,'temporary');
    default:return sql`false`;
  }
}
