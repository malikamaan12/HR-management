import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
export default function ComplianceStatus(){
  const {data=[],isLoading,isError}=useQuery<{id:number;documentType:string;status:string}[]>({queryKey:['/api/documents/expiring']});
  const groups=new Map<string,{expired:number;soon:number}>();
  for(const doc of data){const group=groups.get(doc.documentType)||{expired:0,soon:0};if(doc.status==='expired')group.expired++;else group.soon++;groups.set(doc.documentType,group);}
  return <section className="glass-bento-card p-6 h-full flex flex-col"><h3 className="text-xl font-bold mb-4">Document compliance</h3>
    <div className="space-y-3 flex-1">{isLoading?<p>Loading…</p>:isError?<p>Unable to load compliance data.</p>:groups.size===0?<p>No expired or soon-expiring documents.</p>:
      [...groups].map(([type,counts])=><div key={type} className="border-b pb-3"><p className="font-medium">{type.replaceAll('_',' ')}</p><p className="text-sm"><span className="text-rose-600">{counts.expired} expired</span> · <span className="text-amber-600">{counts.soon} expiring soon</span></p></div>)}</div>
    <Link href="/documents" className="mt-4 text-indigo-600">Review documents →</Link></section>;
}
