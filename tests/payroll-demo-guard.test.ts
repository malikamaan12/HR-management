import {test,expect,vi,afterEach} from 'vitest';
import {isDemoPayroll,payrollDataClassification,defaultWpsSettings,type PayrollExportRow} from '../shared/payroll-exports';
import {sifFile,payrollCsv,payslipDocument} from '../server/services/payroll-export-files';
afterEach(()=>vi.unstubAllEnvs());
test('explicit demo references cannot become bank files or payment-confirming payslips',()=>{
 const row={id:1,employeeRef:'SYN-1',name:'Synthetic Example',status:'processed',paymentReference:'DEMO-NOT-A-PAYMENT-1',groups:[],allowances:{},deductions:{},basic:'100.00',net:'100.00',roundingCents:0,currency:'QAR'} as unknown as PayrollExportRow;
 const filter={year:2026,month:9,kind:'all'} as const;
 expect(isDemoPayroll(row)).toBe(true);expect(isDemoPayroll({paymentReference:'BANK-123'})).toBe(false);
 expect(()=>sifFile(defaultWpsSettings,[row],filter)).toThrow('Demo payroll');expect(payrollCsv([row])).toContain('DEMO — NOT FOR PAYMENT');
 const html=payslipDocument({companyName:'Synthetic'} as any,[row],filter);expect(html).toContain('DEMO — NOT FOR PAYMENT');expect(html).not.toContain('External payment has been recorded.');
});
test('demo environments label every record and the file generator itself refuses payment output',()=>{
 vi.stubEnv('APP_DATA_MODE','demo');
 const row={id:2,employeeRef:'SYN-2',name:'Synthetic Example',status:'processed',paymentReference:null,groups:[],allowances:{},deductions:{},basic:'100.00',net:'100.00',roundingCents:0,currency:'QAR'} as unknown as PayrollExportRow;
 const filter={year:2026,month:9,kind:'all'} as const;
 expect(()=>sifFile(defaultWpsSettings,[row],filter)).toThrow('demo workspace');
 expect(payrollCsv([row])).toContain('DEMO — NOT FOR PAYMENT');
 const html=payslipDocument({companyName:'Synthetic'} as any,[row],filter);expect(html).toContain('DEMO — NOT FOR PAYMENT');expect(html).not.toContain('External payment has been recorded.');
 expect(payrollDataClassification(row,undefined)).toContain('Unconfirmed');
 vi.stubEnv('APP_DATA_MODE','');vi.stubEnv('NODE_ENV','production');expect(()=>sifFile(defaultWpsSettings,[row],filter)).toThrow('Confirm APP_DATA_MODE');
});
