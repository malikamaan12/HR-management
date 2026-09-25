import {useQuery} from '@tanstack/react-query';
import {Section,Table,QueryError} from '@/components/hr/Operations';
import {Button} from '@/components/ui/button';
type Sources={payroll:{id:number;month:number;year:number;status:string;net:string;currency:string|null;period_start:string|null;period_end:string|null;payment_reference:string|null}[];leave:{type:string;year:number;postedDays:number;reservedDays:number;availableDays:number}[];pendingLeave:unknown[];totals:Record<string,{approvedUnpaidCents:number;paidCents:number}>};
export default function SettlementReconciliation({id,completed=false}:{id:number;completed?:boolean}){
 const query=useQuery<{current:Sources;reviewed:Sources|null;changed:boolean;enteredSalary:string;enteredLeaveDays:number;currency:string|null}>({queryKey:[`/api/separations/${id}/reconciliation`]});
 const data=query.data;
 return <Section title="Payroll and leave reconciliation"><QueryError error={query.error}/><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh source records</Button>{query.isLoading&&<p role="status">Loading source balances…</p>}{data&&<>
  <p>Entered outstanding salary: {data.enteredSalary} {data.currency}. Entered leave: {data.enteredLeaveDays} days. Compare these amounts with the source records and explain any difference in the case reconciliation note.</p>
  {data.changed&&<p role="alert" className="font-semibold text-destructive">Source records changed since submission. {completed?'The completed case retains its reviewed figures; reconcile subsequent changes in the payment review below.':'This case needs fresh reconciliation before approval or completion.'}</p>}
  {!!data.current.pendingLeave.length&&<p role="alert">Resolve {data.current.pendingLeave.length} pending leave request(s) before submitting this case.</p>}
  {Object.entries(data.current.totals).map(([currency,total])=><p key={currency}>{currency}: approved unpaid payroll {(total.approvedUnpaidCents/100).toFixed(2)}; payment already recorded {(total.paidCents/100).toFixed(2)}. Explicitly marked demo payments are excluded from these totals.</p>)}
  <p className="text-sm text-muted-foreground">Payroll totals include saved periods starting on or before the leaving date; review any period ending after it. These records do not prove bank receipt. Leave figures reflect the current ledger and pending reservations, not a legal decision about which leave can be paid.</p>
  <Table headers={['Payroll','Period','Status','Net','Payment reference']} rows={data.current.payroll.map(p=>[`#${p.id}`,p.period_start?`${p.period_start} – ${p.period_end}`:`${p.year}-${p.month} (legacy)`,p.status,`${p.net} ${p.currency||'Unspecified'}`,p.payment_reference||'None'])} pageSize={10}/>
  <Table headers={['Leave type','Year','Posted days','Reserved days','Available days']} rows={data.current.leave.map(l=>[l.type,l.year,l.postedDays,l.reservedDays,l.availableDays])} pageSize={10}/>
  {data.reviewed&&<details><summary className="cursor-pointer font-medium">Source totals saved at submission</summary>{Object.entries(data.reviewed.totals).map(([currency,t])=><p key={currency}>{currency}: unpaid {(t.approvedUnpaidCents/100).toFixed(2)}, paid {(t.paidCents/100).toFixed(2)}</p>)}<Table headers={['Leave type','Year','Reviewed available days']} rows={data.reviewed.leave.map(l=>[l.type,l.year,l.availableDays])}/></details>}
 </>}</Section>;
}
