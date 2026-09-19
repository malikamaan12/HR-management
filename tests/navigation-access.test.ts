import {describe,it,expect} from 'vitest';
import {pages,pageForPath,canOpenPage,pageLabel} from '../shared/navigation';
import {ROLE_PERMISSIONS,getAccessibleModules,canAccessData} from '../shared/permissions';
import type {UserRole} from '../shared/schema';
const page=(path:string)=>pageForPath(path)!;
describe('navigation access boundaries',()=>{
 it('rejects anonymous and unknown roles for every page',()=>{for(const p of pages){expect(canOpenPage(undefined,p)).toBe(false);expect(canOpenPage('unknown' as UserRole,p,true)).toBe(false);}expect(getAccessibleModules('unknown' as UserRole)).toEqual([]);});
 it('limits administration routes to administrators across every role',()=>{for(const role of Object.keys(ROLE_PERMISSIONS) as UserRole[])for(const p of pages.filter(p=>p.access==='admin'))expect(canOpenPage(role,p)).toBe(['admin','super_admin'].includes(role));});
 it('keeps dashboard and employee self-service available without granting reports or administration',()=>{expect(canOpenPage('employee',page('/'))).toBe(true);expect(canOpenPage('employee',page('/reports'))).toBe(false);expect(canOpenPage('employee',page('/payroll'))).toBe(true);expect(pageLabel(page('/payroll'),'employee')).toBe('My payroll');});
 it('allows communication roles with create access and denies HR bulk import',()=>{expect(canOpenPage('manager',page('/communications'))).toBe(true);expect(canOpenPage('hr',page('/bulk-import'))).toBe(false);});
 it('requires dated team access outside workforce administration',()=>{expect(canOpenPage('department_head',page('/org-charts'))).toBe(false);expect(canOpenPage('department_head',page('/org-charts'),true)).toBe(true);expect(canOpenPage('hr',page('/org-charts'))).toBe(true);});
 it('resolves nested pages and does not match unrelated prefixes',()=>{expect(page('/event-staff/archive').href).toBe('/event-staff');expect(page('/timesheets/123?tab=review').href).toBe('/timesheets');expect(pageForPath('/settings-other')).toBeUndefined();expect(new Set(pages.map(p=>p.href)).size).toBe(pages.length);});
 it('does not treat missing user identifiers as ownership',()=>{expect(canAccessData('employee','employee_database','own')).toBe(false);});
});
