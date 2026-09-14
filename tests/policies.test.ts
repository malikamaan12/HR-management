import {expect,test} from 'vitest';
import {calculatePayroll,moneyCents,csvCell} from '../shared/money';
import {leaveDays,companySettingsSchema,defaultCompanySettings,managementOfficeScheduleSchema,employeeWeekendDays,defaultManagementOfficeSchedule} from '../shared/settings';
test('payroll arithmetic preserves cents and rejects invalid amounts',()=>{
 expect(calculatePayroll('1000.10',{housing:'200.20'},{loan:'0.30'}).netSalary).toBe('1200.00');
 expect(()=>calculatePayroll('100',{}, {loan:'101'})).toThrow(/exceed/);
 for(const value of ['-1','NaN','1.001','1e5'])expect(()=>moneyCents(value)).toThrow();
});

test('management works Sunday to Thursday from 09:00 to 17:00 in Qatar without changing other calendars',()=>{
 expect(defaultManagementOfficeSchedule).toEqual({workingDays:[0,1,2,3,4],startTime:'09:00',endTime:'17:00',timezone:'Asia/Qatar'});
 expect(employeeWeekendDays({workSchedule:'management_office'},defaultCompanySettings)).toEqual([5,6]);
 expect(leaveDays('2026-09-13','2026-09-17',employeeWeekendDays({workSchedule:'management_office'},defaultCompanySettings))).toBe(5);
 expect(leaveDays('2026-09-18','2026-09-19',employeeWeekendDays({workSchedule:'management_office'},defaultCompanySettings))).toBe(0);
 for(const workSchedule of ['shift_based','unassigned',undefined])expect(employeeWeekendDays({workSchedule},defaultCompanySettings)).toEqual([0,6]);
 for(const patch of [{workingDays:[]},{workingDays:[0,0]},{workingDays:[7]},{startTime:'25:00'},{endTime:'08:59'},{timezone:'Invalid/Zone'}])expect(managementOfficeScheduleSchema.safeParse({...defaultManagementOfficeSchedule,...patch}).success).toBe(false);
 expect(()=>leaveDays('2026-02-30','2026-03-02',[])).toThrow();
});
test('CSV cells quote newlines and commas and neutralize formula prefixes',()=>{
 expect(csvCell('Doe, Jane')).toBe('"Doe, Jane"');
 expect(csvCell('=SUM(A1:A9)')).toBe('"\'=SUM(A1:A9)"');
 expect(csvCell('a"b')).toBe('"a""b"');
});
test('leave uses the configured non-working days and bounds the date range',()=>{
 expect(leaveDays('2026-09-11','2026-09-13',[5,6])).toBe(1);
 expect(leaveDays('2026-09-11','2026-09-13',[0,6])).toBe(1);
 expect(leaveDays('2026-09-11','2026-09-13',[])).toBe(3);
 expect(()=>leaveDays('2026-09-13','2026-09-11',[])).toThrow();
 expect(companySettingsSchema.safeParse({...defaultCompanySettings,weekendDays:[0,0]}).success).toBe(false);
});
