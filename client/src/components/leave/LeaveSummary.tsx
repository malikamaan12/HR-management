import {LeaveLedger} from './LeaveLedger';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {format,startOfMonth,endOfMonth} from 'date-fns';
import {Calendar} from '@/components/ui/calendar';
import {Button} from '@/components/ui/button';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';

type CalendarLeave={id:number;employeeName:string;startDate:string;endDate:string;department:string};
export function LeaveSummary({employeeId,types}:{employeeId?:number;types:Array<{id:number;name:string}>}){
  const [month,setMonth]=useState(new Date()),[selected,setSelected]=useState<Date|undefined>(new Date());
  const start=format(startOfMonth(month),'yyyy-MM-dd'),end=format(endOfMonth(month),'yyyy-MM-dd');
  const calendar=useQuery<CalendarLeave[]>({queryKey:[`/api/leaves/calendar?start=${start}&end=${end}`]});
  const selectedDate=selected?format(selected,'yyyy-MM-dd'):'';
  const rows=(calendar.data||[]).filter(row=>row.startDate<=selectedDate&&row.endDate>=selectedDate);
  return <div className="grid md:grid-cols-2 gap-6">
    <Card><CardHeader><CardTitle>Approved leave calendar</CardTitle></CardHeader><CardContent>
      {calendar.isError?<div role="alert">Unable to load calendar. <Button onClick={()=>calendar.refetch()}>Retry</Button></div>:<>
        <Calendar mode="single" month={month} onMonthChange={setMonth} selected={selected} onSelect={setSelected}
          modifiers={{leave:day=>(calendar.data||[]).some(row=>row.startDate<=format(day,'yyyy-MM-dd')&&row.endDate>=format(day,'yyyy-MM-dd'))}} modifiersClassNames={{leave:'font-bold underline decoration-primary'}}/>
        <p className="text-sm text-muted-foreground">Underlined days include approved leave in your access scope.</p>
        {calendar.isLoading?<p>Loading approved leave…</p>:<div className="mt-3 space-y-2"><p className="font-medium">{selectedDate||'Select a day'}</p>{selectedDate&&!rows.length?<p className="text-sm">No approved leave on this day.</p>:rows.map(row=><p key={row.id} className="text-sm">{row.employeeName} · {row.department} · {row.startDate} – {row.endDate}</p>)}</div>}
      </>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Leave allocation ledger</CardTitle></CardHeader><CardContent><LeaveLedger employeeId={employeeId}/></CardContent></Card>
  </div>;
}
