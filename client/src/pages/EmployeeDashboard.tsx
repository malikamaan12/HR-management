import {useQuery} from '@tanstack/react-query';
import {Link} from 'wouter';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
type Dashboard={employee:{firstName:string;department:string};date:string;attendance:{checkIn:string|null;checkOut:string|null;totalWorkHours:number|null}|null;
 leaves:{available:number|null;used:number;pending:number;upcoming:{id:number;startDate:string;endDate:string;leaveType:string}[]};documents:{total:number;expired:number;expiring:number};performance:{rating:string|null;lastReview:string|null;goals:number};payroll:{month:number;year:number;netSalary:string}|null};
export default function EmployeeDashboard(){
 const {data,isLoading,error}=useQuery<Dashboard>({queryKey:['/api/employee/dashboard']});
 if(isLoading)return <p>Loading your dashboard…</p>;
 if(error||!data)return <p role="alert">Unable to load your employee dashboard. Ask HR to check that your account is linked to an employee record.</p>;
 const time=(value:string|null|undefined)=>value?new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'—';
 return <div className="space-y-6"><div><h1 className="text-2xl font-bold">Welcome, {data.employee.firstName}</h1><p>{data.employee.department} · {data.date}</p></div><div className="grid gap-4 md:grid-cols-2">
  <Card><CardHeader><CardTitle>Today's attendance</CardTitle></CardHeader><CardContent><p>Check in: {time(data.attendance?.checkIn)}</p><p>Check out: {time(data.attendance?.checkOut)}</p><p>Recorded work: {Math.floor((data.attendance?.totalWorkHours||0)/60)}h {(data.attendance?.totalWorkHours||0)%60}m</p><Link href="/attendance" className="text-primary">Open time clock →</Link></CardContent></Card>
  <Card><CardHeader><CardTitle>Leave</CardTitle></CardHeader><CardContent><p>{data.leaves.available===null?'Leave balance has not been configured':`${data.leaves.available} days in recorded balances`}</p><p>{data.leaves.used} approved days this year · {data.leaves.pending} pending requests</p><Link href="/leave" className="text-primary">Manage leave →</Link></CardContent></Card>
  <Card><CardHeader><CardTitle>Documents</CardTitle></CardHeader><CardContent><p>{data.documents.total} documents · {data.documents.expired} expired · {data.documents.expiring} expiring soon</p><Link href="/documents" className="text-primary">Review documents →</Link></CardContent></Card>
  <Card><CardHeader><CardTitle>Latest recorded payment</CardTitle></CardHeader><CardContent>{data.payroll?<p>{data.payroll.month}/{data.payroll.year} · QAR {Number(data.payroll.netSalary).toFixed(2)}</p>:<p>No payment recorded.</p>}<Link href="/payroll" className="text-primary">View payroll →</Link></CardContent></Card>
  <Card><CardHeader><CardTitle>Performance</CardTitle></CardHeader><CardContent><p>Last completed review: {data.performance.rating?.replaceAll('_',' ')||'No completed review'}</p><p>{data.performance.goals} active goals</p></CardContent></Card>
 </div></div>;
}
