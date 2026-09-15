import {Router} from 'express';
import {authenticate} from '../middleware/auth';
import {db} from '../db';
import {employees,leaves,attendance,documents,performanceReviews,employeeGoals,payroll,leaveBalances,leaveLedger} from '@shared/schema';
import {leaveAccount} from '../services/leave-ledger';
import {eq,and,gte,lte,desc,inArray} from 'drizzle-orm';
import {attendanceDate} from '../services/attendance';
import {getCompanySettings} from '../services/settings';
const router=Router();router.use(authenticate);
router.get('/profile',async(req,res)=>{
 try{const [employee]=await db.select().from(employees).where(eq(employees.userId,req.user!.userId));
 if(!employee)return res.status(404).json({message:'Your account needs to be linked to an employee record'});return res.json(employee);
 }catch{return res.status(500).json({message:'Unable to load employee profile'});}
});
router.get('/dashboard',async(req,res)=>{
 try{
  const [employee]=await db.select().from(employees).where(eq(employees.userId,req.user!.userId));
  if(!employee)return res.status(404).json({message:'Your account needs to be linked to an employee record'});
  const today=attendanceDate(new Date()),year=Number(today.slice(0,4)),policy=await getCompanySettings();
  const [todayAttendance,requests,files,reviews,goals,payslips,balances]=await Promise.all([
   db.select().from(attendance).where(and(eq(attendance.employeeId,employee.id),eq(attendance.date,today))),
   db.select().from(leaves).where(and(eq(leaves.employeeId,employee.id),gte(leaves.startDate,`${year}-01-01`),lte(leaves.startDate,`${year}-12-31`))),
   db.select({expiryDate:documents.expiryDate}).from(documents).where(eq(documents.employeeId,employee.id)),
   db.select().from(performanceReviews).where(and(eq(performanceReviews.employeeId,employee.id),eq(performanceReviews.status,'completed'))).orderBy(desc(performanceReviews.completedDate)).limit(1),
   db.select({id:employeeGoals.id}).from(employeeGoals).where(and(eq(employeeGoals.employeeId,employee.id),inArray(employeeGoals.status,['not_started','in_progress','extended']))),
   db.select().from(payroll).where(and(eq(payroll.employeeId,employee.id),eq(payroll.status,'processed'))).orderBy(desc(payroll.year),desc(payroll.month)).limit(1),
   db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId,employee.id),eq(leaveBalances.year,year)))
  ]);
  const soon=new Date(Date.parse(today)+policy.documentExpiryDays*86400000).toISOString().slice(0,10);
  const ledgerTypes=await db.selectDistinct({name:leaveLedger.leaveType}).from(leaveLedger).where(and(eq(leaveLedger.employeeId,employee.id),eq(leaveLedger.year,year)));
  const ledgerAccounts=await Promise.all(ledgerTypes.map(type=>leaveAccount(db,employee.id,type.name,year)));
  return res.json({employee:{firstName:employee.firstName,department:employee.department},date:today,
   attendance:todayAttendance[0]||null,
   leaves:{available:ledgerAccounts.length?(ledgerAccounts.some(a=>a.needsReconciliation)?null:ledgerAccounts.reduce((sum,a)=>sum+a.available,0)):balances.length?balances.reduce((sum,b)=>sum+Number(b.openingBalance)+Number(b.accrued)+Number(b.adjusted)-Number(b.used)-Number(b.pending),0):null,balanceSource:ledgerAccounts.length?'allocation_ledger':'legacy',used:requests.filter(r=>r.status==='approved').reduce((sum,r)=>sum+r.totalDays,0),pending:requests.filter(r=>r.status==='pending').length,upcoming:requests.filter(r=>r.status==='approved'&&r.endDate>=today)},
   documents:{total:files.length,expired:files.filter(f=>f.expiryDate<today).length,expiring:files.filter(f=>f.expiryDate>=today&&f.expiryDate<=soon).length},
   performance:{rating:reviews[0]?.overallRating||null,lastReview:reviews[0]?.completedDate||null,goals:goals.length},
   payroll:payslips[0]?{month:payslips[0].month,year:payslips[0].year,netSalary:payslips[0].netSalary}:null});
 }catch(error){console.error('Employee dashboard failed');return res.status(500).json({message:'Unable to load your dashboard'});}
});
export default router;
