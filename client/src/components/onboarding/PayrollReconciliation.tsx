import {useQuery} from '@tanstack/react-query';
import type {reconcilePayroll} from '@shared/payroll-reconciliation';
import {csvCell} from '@shared/money';
import {Button} from '@/components/ui/button';
export function PayrollReconciliation({month,year}:{month:number;year:number}){
 const query=useQuery<ReturnType<typeof reconcilePayroll>>({queryKey:['/api/payroll/reconciliation',{month,year}],enabled:!!month&&!!year});
 const report=query.data;
 function download(){if(!report)return;const csv=[['Payroll ID','Employee','Status','Payment reference','Stored net QAR','Expected net QAR','Issues'],...report.items.map(r=>[r.id,r.employeeName,r.status,r.reference,r.storedNet,r.expectedNet,r.issues.join('; ')])].map(r=>r.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`payroll-reconciliation-${year}-${month}.csv`;a.click();URL.revokeObjectURL(url);}
 return <details className="my-4 rounded border p-4"><summary className="cursor-pointer font-semibold">Payroll reconciliation</summary>
  {query.isLoading?<p>Checking payroll…</p>:query.error?<p role="alert">Unable to load reconciliation.</p>:report&&<div className="mt-3 space-y-3">
   <p className="text-sm">{report.scope} These checks compare saved calculations and payment-reference records; they do not confirm bank receipt or entitlement accuracy.</p>
   <p>{report.totals.records} records · {report.totals.flagged} need review</p>
   <div className="grid gap-2 md:grid-cols-2"><p>Stored net: QAR {report.totals.storedNet}</p><p>Recalculated net: QAR {report.totals.expectedNet}</p><p>Pending net: QAR {report.totals.pendingNet}</p><p>Recorded paid net: QAR {report.totals.processedNet}</p></div>
   {(report.totals.unverifiable>0||report.totals.invalidStored>0)&&<p role="alert">Totals are partial: {report.totals.unverifiable} records could not be recalculated; {report.totals.invalidStored} stored amounts could not be summed.</p>}
   <div className="flex gap-2"><Button variant="outline" onClick={()=>query.refetch()}>Recheck</Button><Button variant="outline" onClick={download}>Export reconciliation CSV</Button></div>
   <ul className="space-y-2">{report.items.filter(r=>r.issues.length).map(r=><li key={r.id}>#{r.id} · {r.employeeName}: {r.issues.join('; ')}</li>)}</ul>
  </div>}
 </details>;
}
