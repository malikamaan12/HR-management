import {ExperienceHero} from '@/components/ux/ExperienceUI';
import { HelpdeskWorkspace } from '@/components/hr/HelpdeskWorkspace';
import { categoryName } from '@shared/helpdesk-workspace';
import { CaseTargets } from '@/components/hr/HelpdeskOperations';
import {useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {Link,useLocation,useRoute} from 'wouter';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,LifeBuoy,LockKeyhole,MessageSquare,Paperclip,Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Card,CardHeader,CardContent,CardTitle} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useToast} from '@/hooks/use-toast';
import {apiJson} from '@/lib/queryClient';
import {statusLabels,type CaseDetail,type HelpdeskConfig,type CaseStatus} from '@shared/helpdesk';

const selectClass='w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const stamp=(value:string)=>new Date(value).toLocaleString([],{dateStyle:'medium',timeStyle:'short'});
function Field({label,children}:{label:string;children:ReactNode}){return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>;}
function useHelpdeskMutation(){
  const cache=useQueryClient(),{toast}=useToast();
  const refresh=()=>cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/helpdesk/')});
  return useMutation({mutationFn:({url,body}:{url:string;body:unknown})=>apiJson<{id?:number}>(url,{method:'POST',body}),
    onSuccess:async()=>{await refresh();toast({title:'Saved'});},onError:async(error)=>{toast({title:'Unable to save',description:error.message,variant:'destructive'});if(error.message.startsWith('409:'))await refresh();}});
}
function FileField({available,onChange,resetKey,limit}:{available:boolean;onChange:(file:File|null)=>void;resetKey:number;limit:number}){
  return <Field label="Attachment (optional)"><Input key={resetKey} type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={!available} onChange={e=>{const file=e.target.files?.[0]||null;e.target.setCustomValidity(file&&file.size>limit*1024*1024?`Choose a file no larger than ${limit} MB`:'');e.target.reportValidity();onChange(file);}}/><span className="text-xs font-normal text-muted-foreground">{available?`One PDF, PNG or JPEG, up to ${limit} MB.`:'Private file storage is not configured. Text requests and replies are available.'}</span></Field>;
}
export default function Helpdesk(){
  const [,navigate]=useLocation(),[,params]=useRoute('/helpdesk/:caseId');const caseId=params?Number(params.caseId):null;
  const config=useQuery<HelpdeskConfig>({queryKey:['/api/helpdesk/config']});
  const [create,setCreate]=useState(false),[initialCategory,setInitialCategory]=useState(''),[draftKey,setDraftKey]=useState(0);
  function startRequest(category=''){setInitialCategory(category);setDraftKey(key=>key+1);setCreate(true);}
  if(config.isLoading)return <div role="status" className="rounded-xl border p-8">Loading helpdesk...</div>;
  if(config.error||!config.data)return <div role="alert" className="space-y-3 rounded-xl border p-6"><p>Unable to load helpdesk configuration. Please retry or contact your administrator.</p><Button variant="outline" onClick={()=>config.refetch()}>Try again</Button></div>;
  const {workspace}=config.data;
  return <div className="space-y-6"><ExperienceHero eyebrow="Your support space" title={workspace.title} description="Ask. Track. Get back to your day." icon={LifeBuoy} variant="mint" actions={<Button onClick={()=>startRequest()}><Plus className="h-4 w-4"/>New request</Button>}/>
    {params?(caseId&&Number.isSafeInteger(caseId)&&caseId>0?<CasePanel key={caseId} id={caseId} config={config.data}/>:<p role="alert">Invalid request. <Link href="/helpdesk" className="text-primary underline">Back to requests</Link></p>):<HelpdeskWorkspace config={config.data} create={startRequest}/>}
    <NewCase key={draftKey} initialCategory={initialCategory} open={create} close={()=>setCreate(false)} config={config.data} created={id=>{setCreate(false);navigate(`/helpdesk/${id}`);}}/>
  </div>;
}
function NewCase({open,close,config,created,initialCategory}:{open:boolean;close:()=>void;config:HelpdeskConfig;created:(id:number)=>void;initialCategory:string}){
  const [title,setTitle]=useState(''),[category,setCategory]=useState(initialCategory),[confidential,setConfidential]=useState(false),[body,setBody]=useState(''),[file,setFile]=useState<File|null>(null),[fileKey,setFileKey]=useState(0);
  const mutation=useHelpdeskMutation();
  const restricted=confidential||Boolean(config.workspace.categories.find(c=>c.id===category)?.confidential);
  async function submit(event:FormEvent){event.preventDefault();const data=new FormData();data.set('title',title);data.set('category',category);data.set('confidential',String(restricted));data.set('body',body);if(file)data.set('file',file);
    try{const result=await mutation.mutateAsync({url:'/api/helpdesk/cases',body:data});setTitle('');setBody('');setFile(null);setFileKey(k=>k+1);setConfidential(false);setCategory('');created(result.id!);}catch{}}
  return <Dialog open={open} onOpenChange={value=>{if(!value&&!mutation.isPending)close();}}><DialogContent className="max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>New HR request</DialogTitle><DialogDescription>{config.workspace.requestGuidance||config.workspace.title}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submit}><fieldset disabled={mutation.isPending} className="space-y-4">
    {config.workspace.categories.find(c=>c.id===category)?.description&&<p className="text-sm text-muted-foreground">{config.workspace.categories.find(c=>c.id===category)?.description}</p>}<Field label="Subject"><Input value={title} onChange={e=>setTitle(e.target.value)} minLength={4} maxLength={160} required autoFocus/></Field><Field label="Category"><select className={selectClass} required value={category} onChange={e=>setCategory(e.target.value as typeof category)}><option value="">Choose a category...</option>{config.workspace.categories.filter(c=>c.enabled).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={restricted} disabled={Boolean(config.workspace.categories.find(c=>c.id===category)?.confidential)} onChange={e=>setConfidential(e.target.checked)}/>Confidential request</label>
    <p className="text-sm text-muted-foreground">{restricted?'Visible to you, HR directors/system owners and any specifically assigned HR responder.':'Visible to you, HR triagers and any assigned HR responder. Team leads do not receive access through team membership.'}</p>
    <Field label="Details"><Textarea value={body} onChange={e=>setBody(e.target.value)} minLength={10} maxLength={10000} rows={5} required placeholder="Explain the issue and the help you need."/></Field><FileField limit={config.workspace.attachmentMegabytes} available={config.attachmentsAvailable} onChange={setFile} resetKey={fileKey}/>
    <QueryFailure error={mutation.error}/><div className="flex justify-end gap-2"><Button variant="outline" type="button" disabled={mutation.isPending} onClick={close}>Close</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending?'Submitting…':'Submit request'}</Button></div>
  </fieldset></form></DialogContent></Dialog>;
}
function CasePanel({id,config}:{id:number;config:HelpdeskConfig}){
  const query=useQuery<CaseDetail>({queryKey:[`/api/helpdesk/cases/${id}`],refetchInterval:30000,refetchIntervalInBackground:false});
  const mutation=useHelpdeskMutation();
  const [body,setBody]=useState(''),[internal,setInternal]=useState(false),[file,setFile]=useState<File|null>(null),[fileKey,setFileKey]=useState(0),[nextStatus,setNextStatus]=useState(''),[reason,setReason]=useState('');
  if(query.isLoading)return <p>Loading request…</p>;
  if(query.error||!query.data)return <div role="alert" className="space-y-3"><p>This request is unavailable or you no longer have access.</p><Link href="/helpdesk" className="text-primary">Back to requests</Link></div>;
  const {case:row,capabilities:access,messages,events}=query.data;
  async function reply(event:FormEvent){event.preventDefault();const data=new FormData();data.set('version',String(row.version));data.set('body',body);data.set('internal',String(internal&&access.internal));if(file)data.set('file',file);
    try{await mutation.mutateAsync({url:`/api/helpdesk/cases/${id}/messages`,body:data});setBody('');setFile(null);setFileKey(k=>k+1);}catch{}}
  async function changeStatus(event:FormEvent){event.preventDefault();try{await mutation.mutateAsync({url:`/api/helpdesk/cases/${id}/actions`,body:{action:'status',version:row.version,status:nextStatus,reason}});setNextStatus('');setReason('');}catch{}}
  return <div className="space-y-5"><Link href="/helpdesk" className="inline-flex items-center text-sm text-primary"><ArrowLeft className="mr-2 h-4 w-4"/>Back to requests</Link><Card><CardContent className="pt-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">Request #{row.id} · {categoryName(config.workspace,row.category)}</p><h2 className="mt-2 break-words text-2xl font-semibold">{row.title}</h2></div><div className="flex gap-2">{row.confidential&&<Badge variant="outline"><LockKeyhole className="mr-1 h-3 w-3"/>Confidential</Badge>}<Badge>{statusLabels[row.status]}</Badge></div></div><p className="mt-3 text-sm text-muted-foreground">Requested by {row.requesterName} · Handler: {row.assigneeName||'Awaiting assignment'}</p></CardContent></Card>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]"><div className="space-y-5"><Card><CardHeader><CardTitle>Conversation</CardTitle></CardHeader><CardContent className="space-y-4">{messages.map(message=><article key={message.id} className={`rounded-lg border p-4 ${message.internal?'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20':''}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{message.authorName}{message.internal&&<Badge variant="outline" className="ml-2">Internal HR note</Badge>}</p><time className="text-xs text-muted-foreground">{stamp(message.createdAt)}</time></div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>{message.attachments.map(a=><a key={a.id} href={`/api/helpdesk/attachments/${a.id}/download`} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 break-all text-sm text-primary"><Paperclip className="h-4 w-4 shrink-0"/>{a.filename} ({Math.ceil(a.size/1024)} KB)</a>)}</article>)}</CardContent></Card>
      {access.reply?<Card><CardHeader><CardTitle>{internal&&access.internal?'Add internal note':'Reply'}</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={reply}>{access.internal&&<Field label="Message visibility"><select className={selectClass} value={internal?'internal':'reply'} onChange={e=>setInternal(e.target.value==='internal')}><option value="reply">Reply visible to employee</option><option value="internal">Internal HR note</option></select></Field>}<p className={`rounded-lg p-3 text-xs ${internal&&access.internal?'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200':'bg-muted text-muted-foreground'}`}>{internal&&access.internal?'Only authorized HR case handlers can read this note. The employee cannot see it.':'This reply will be visible to the requester and authorized HR case handlers.'}</p><Field label={internal&&access.internal?'Internal note':'Your reply'}><Textarea value={body} onChange={e=>setBody(e.target.value)} rows={4} minLength={1} maxLength={10000} required/></Field><FileField limit={config.workspace.attachmentMegabytes} available={config.attachmentsAvailable} onChange={setFile} resetKey={fileKey}/><QueryFailure error={mutation.error}/><Button type="submit" disabled={mutation.isPending}><MessageSquare className="mr-2 h-4 w-4"/>{mutation.isPending?'Saving…':internal&&access.internal?'Save internal note':'Send reply'}</Button></form></CardContent></Card>:<p className="rounded-md bg-muted p-4 text-sm">This request is {statusLabels[row.status].toLowerCase()}. Reopen it to continue the conversation.</p>}
    </div><div className="space-y-5">
      <CaseTargets detail={query.data}/>
      {access.assign&&row.status!=='closed'&&<AssignmentPanel id={id} version={row.version} current={row.assigneeId}/>}
      {!!access.statuses.length&&<Card><CardHeader><CardTitle>Update status</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={changeStatus}><Field label="New status"><select className={selectClass} value={access.statuses.includes(nextStatus as CaseStatus)?nextStatus:''} onChange={e=>setNextStatus(e.target.value)} required><option value="">Choose status…</option>{access.statuses.map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}</select></Field><Field label="Reason visible to employee"><Textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={1000} required/></Field><Button type="submit" disabled={mutation.isPending}>Update status</Button></form></CardContent></Card>}
      {access.restrict&&<Card><CardHeader><CardTitle>Privacy</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Restrict this case to you, HR directors/system owners and its assigned HR handler. The existing handler keeps access. This screen cannot make a confidential case public again.</p><Button variant="outline" disabled={mutation.isPending} onClick={()=>mutation.mutate({url:`/api/helpdesk/cases/${id}/actions`,body:{action:'restrict',version:row.version}})}><LockKeyhole className="mr-2 h-4 w-4"/>Make confidential</Button></CardContent></Card>}
      <Card><CardContent className="pt-6"><details><summary className="cursor-pointer font-semibold">Case history ({events.length})</summary><div className="mt-4 space-y-4">{events.map(event=><div key={event.id} className="border-l-2 pl-3"><p className="whitespace-pre-wrap break-words text-sm">{event.details}</p><p className="mt-1 text-xs text-muted-foreground">{event.actorName} · {stamp(event.createdAt)}</p></div>)}</div></details></CardContent></Card>
    </div></div>
  </div>;
}
function AssignmentPanel({id,version,current}:{id:number;version:number;current:number|null}){
  const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[assignee,setAssignee]=useState('');const mutation=useHelpdeskMutation();
  useEffect(()=>{const timer=setTimeout(()=>setTerm(search.trim()),300);return()=>clearTimeout(timer);},[search]);
  const people=useQuery<{id:number;name:string;role:string}[]>({queryKey:[`/api/helpdesk/cases/${id}/assignees`,{q:term}],enabled:term.length>=2});
  return <Card><CardHeader><CardTitle>Assign HR handler</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={async e=>{e.preventDefault();try{await mutation.mutateAsync({url:`/api/helpdesk/cases/${id}/actions`,body:{action:'assign',version,assigneeId:Number(assignee)}});setAssignee('');setSearch('');}catch{}}}><Field label="Find HR responder"><Input value={search} onChange={e=>{setSearch(e.target.value);setAssignee('');}} placeholder="Enter at least 2 characters"/></Field>{people.error?<p role="alert" className="text-sm">Unable to search case handlers.</p>:term.length>=2&&<Field label="Select HR handler"><select className={selectClass} value={assignee} onChange={e=>setAssignee(e.target.value)} required><option value="">Choose responder…</option>{people.data?.map(p=><option key={p.id} value={p.id}>{p.name} · {p.role.replaceAll('_',' ')}</option>)}</select></Field>}<div className="flex flex-wrap gap-2"><Button type="submit" disabled={mutation.isPending||!assignee}>Assign</Button>{current&&<Button type="button" variant="outline" disabled={mutation.isPending} onClick={()=>mutation.mutate({url:`/api/helpdesk/cases/${id}/actions`,body:{action:'assign',version,assigneeId:null}})}>Unassign</Button>}</div><p className="text-xs text-muted-foreground">Assignment grants this responder access to the case and its internal HR notes.</p></form></CardContent></Card>;
}

function QueryFailure({error}:{error:Error|null}){return error?<p role="alert" className="text-sm text-destructive">{error.message}</p>:null;}
