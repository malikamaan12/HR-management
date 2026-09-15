import type {Payroll} from './schema';
import {calculationRulesSchema,calculatePolicyPayroll} from './calculation-rules';
import {moneyCents,moneyText} from './money';
export function reconcilePayroll(rows:(Payroll&{employeeName:string})[]){
 const counts=new Map<number,number>();for(const r of rows)counts.set(r.employeeId,(counts.get(r.employeeId)||0)+1);
 let stored=0,expected=0,pending=0,processed=0,invalidStored=0,unverifiable=0;
 const items=rows.map(row=>{
  const issues:string[]=[];let expectedNet:string|null=null,storedNet:string|null=null;
  try{const cents=moneyCents(row.netSalary);stored+=cents;storedNet=moneyText(cents);if(row.status==='pending')pending+=cents;if(row.status==='processed')processed+=cents;}catch{issues.push('Invalid stored net salary');invalidStored++;}
  if(counts.get(row.employeeId)!>1)issues.push('Duplicate employee payroll in period');
  if(row.status==='processed'&&(!row.wpsReference?.trim()||!row.processedAt||!row.processedBy))issues.push('Processed payroll is missing payment evidence');
  if(!['pending','processed','failed'].includes(row.status))issues.push('Unrecognized payroll status');
  try{
   if(!row.calculationSnapshot)throw new Error('No saved policy');
   const rule=calculationRulesSchema.parse(row.calculationSnapshot.rules).payroll;
   if(!row.allowances||Array.isArray(row.allowances)||typeof row.allowances!=='object'||!row.deductions||Array.isArray(row.deductions)||typeof row.deductions!=='object')throw new Error('Invalid component data');
   const calculated=calculatePolicyPayroll(row.basicSalary,row.allowances as Record<string,string>,row.deductions as Record<string,string>,rule);
   expectedNet=calculated.netSalary;expected+=moneyCents(expectedNet);
   if(expectedNet!==storedNet)issues.push('Stored net differs from saved-policy calculation');
   if(row.roundingAdjustmentCents!==calculated.roundingAdjustmentCents)issues.push('Stored rounding adjustment differs from saved policy');
  }catch{issues.push(row.calculationSnapshot?'Invalid saved policy or salary components':'Missing calculation snapshot; requires review');unverifiable++;}
  return {id:row.id,employeeId:row.employeeId,employeeName:row.employeeName,status:row.status,reference:row.wpsReference,storedNet,expectedNet,issues};
 });
 return {items,totals:{records:rows.length,flagged:items.filter(r=>r.issues.length).length,storedNet:moneyText(stored),expectedNet:moneyText(expected),pendingNet:moneyText(pending),processedNet:moneyText(processed),invalidStored,unverifiable},scope:'Only payroll records visible to the signed-in user. Missing snapshots are not recalculated using current policy.'};
}
