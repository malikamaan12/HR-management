import {MetricCard,StatusPill} from '@/components/ux/ModuleVisuals';
import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {ApiDocument} from '@/lib/api-types';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {DocumentRenewalQueue} from '@/components/documents/DocumentRenewalQueue';
import {DocumentReviewPolicy} from '@/components/documents/DocumentReviewPolicy';
import {UploadDocumentModal} from '@/components/documents/UploadDocumentModal';
import {DocumentDetails} from '@/components/documents/DocumentDetails';
import {formatDate} from '@/lib/utils';

type Register={items:ApiDocument[];total:number;counts:Record<string,number>;page:number;pageSize:number;hasMore:boolean;expiryDays:number;asOf:string;canUpload:boolean};
export default function Documents(){
 const [tab,setTab]=useState('register');
 const cache=useQueryClient();const [search,setSearch]=useState(''),[q,setQ]=useState(''),[type,setType]=useState(''),[typeFilter,setTypeFilter]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[upload,setUpload]=useState(false),[selected,setSelected]=useState<number|null>(null);
 useEffect(()=>{const timer=setTimeout(()=>{setQ(search.trim());setTypeFilter(type.trim());setPage(1);},300);return()=>clearTimeout(timer);},[search,type]);
 const query=useQuery<Register>({queryKey:['/api/documents/register',{q,type:typeFilter,status,page}]});
 const refresh=()=>cache.invalidateQueries({predicate:x=>String(x.queryKey[0]).startsWith('/api/documents')});
 return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Document management</h1><p className="text-muted-foreground">Private files, renewal reviews and expiry tracking.</p></div>
 {query.data&&!query.error&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['All documents','all'],['Valid','valid'],['Expiring soon','expiring_soon'],['Expired','expired']].map(([label,key])=><button key={key} className="text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-pressed={status===key} onClick={()=>{setStatus(key);setPage(1);setTab('register');}}><MetricCard label={label} value={query.data!.counts[key]||0} tone={key==='expired'||key==='expiring_soon'?'attention':key==='valid'?'positive':'primary'}/></button>)}</div>}<Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="register">Document register</TabsTrigger><TabsTrigger value="requests">Renewal requests</TabsTrigger><TabsTrigger value="policy">Approval rules</TabsTrigger></TabsList>
 <TabsContent value="register"><section className="rounded-lg border bg-card p-4 space-y-4">
 <div className="flex flex-wrap justify-between gap-2"><h2 className="text-lg font-semibold">Document register</h2><div className="flex gap-2"><Button variant="outline" onClick={()=>refresh()}>Refresh documents</Button>{query.data?.canUpload&&<Button onClick={()=>setUpload(true)}>Upload document</Button>}</div></div>
 <div className="grid gap-3 md:grid-cols-3"><label>Employee, number or type<Input aria-label="Search documents" placeholder="Search documents" value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><label>Document type<Input placeholder="Exact type, e.g. Passport" value={type} maxLength={100} onChange={e=>setType(e.target.value)}/></label><label>Status<select className="block w-full border rounded p-2" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{[['all','All documents'],['valid','Valid'],['expiring_soon','Expiring soon'],['expired','Expired'],['archived','Archived']].map(([value,label])=><option key={value} value={value}>{label}{query.data?' ('+query.data.counts[value]+')':''}</option>)}</select></label></div>
 {query.data&&<p className="text-sm text-muted-foreground">As of {query.data.asOf} (Qatar). Expiring soon covers the next {query.data.expiryDays} days, using the company setting. Counts include your search and type filters.</p>}
 {query.isLoading?<p>Loading documents…</p>:query.isError?<p role="alert">Unable to load documents. <Button onClick={()=>query.refetch()}>Retry</Button></p>:<>
 <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b">{['Employee','Type','Number','Issue date','Expiry date','Status','Actions'].map(s=><th className="p-2" key={s}>{s}</th>)}</tr></thead><tbody>{!query.data?.items.length?<tr><td colSpan={7} className="p-4">No matching documents.</td></tr>:query.data.items.map(doc=><tr className="border-b" key={doc.id}><td className="p-2">{doc.employeeName}</td><td className="p-2">{doc.documentType}</td><td className="p-2">{doc.documentNumber}</td><td className="p-2">{formatDate(doc.issueDate)}</td><td className="p-2">{formatDate(doc.expiryDate)}</td><td className="p-2"><StatusPill value={doc.status}/></td><td className="p-2"><div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>setSelected(doc.id)}>Details</Button>{doc.documentFile&&<Button variant="outline" size="sm" asChild><a href={'/api/documents/'+doc.id+'/download'} target="_blank" rel="noopener noreferrer">Download</a></Button>}</div></td></tr>)}</tbody></table></div>
 <div className="flex flex-wrap gap-3 items-center"><Button variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous documents</Button><span>Page {page} · {query.data?.total??0} matching documents</span><Button variant="outline" disabled={!query.data?.hasMore} onClick={()=>setPage(p=>p+1)}>Next documents</Button></div></>}
 </section></TabsContent><TabsContent value="requests"><DocumentRenewalQueue/></TabsContent><TabsContent value="policy"><DocumentReviewPolicy/></TabsContent></Tabs>
 <UploadDocumentModal isOpen={upload} onClose={()=>{setUpload(false);void refresh();}}/><DocumentDetails documentId={selected} isOpen={selected!==null} onClose={()=>setSelected(null)}/></div>;
}
