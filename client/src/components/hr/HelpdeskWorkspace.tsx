import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'wouter';
import {BookOpen,CircleCheck,Clock3,Inbox,LifeBuoy,LockKeyhole,RefreshCw,Settings2,AlertCircle,ArrowUpRight,Search,SlidersHorizontal,ChevronDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {AnimatedIcon,ProgressRing} from '@/components/ux/ExperienceUI';
import {HelpDisclosure} from '@/components/ux/WorkspaceUI';
import {MetricCard,titleIcon} from '@/components/ux/ModuleVisuals';
import {Field,QueryError,fieldClass} from './Operations';
import {HelpdeskKnowledge,HelpdeskPolicies} from './HelpdeskOperations';
import {HelpdeskAutomationAccess} from './HelpdeskAutomation';
import {HelpdeskSettings} from './HelpdeskSettings';
import {caseStatuses,statusLabels,type CaseList,type HelpdeskConfig,type CaseSummary} from '@shared/helpdesk';
import {categoryName,type HelpdeskOverview} from '@shared/helpdesk-workspace';

const stamp=(value:string)=>new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const colors=['#7c5ce7','#38bdf8','#f0b458','#45bfa1','#94a3b8'];

export function HelpdeskWorkspace({config,create}:{config:HelpdeskConfig;create:(category?:string)=>void}) {
  return <Tabs defaultValue="requests" className="space-y-5">
    <TabsList aria-label="Helpdesk sections"><TabsTrigger value="requests"><Inbox className="mr-2 h-4 w-4"/>Inbox</TabsTrigger><TabsTrigger value="knowledge"><BookOpen className="mr-2 h-4 w-4"/>Guides</TabsTrigger>{config.canManagePolicies&&<TabsTrigger value="admin"><Settings2 className="mr-2 h-4 w-4"/>Manage</TabsTrigger>}</TabsList>
    <TabsContent value="requests"><Requests config={config} create={create}/></TabsContent>
    <TabsContent value="knowledge"><HelpdeskKnowledge config={config}/></TabsContent>
    {config.canManagePolicies&&<TabsContent value="admin" className="space-y-5"><HelpdeskSettings config={config}/><HelpdeskPolicies config={config}/><HelpdeskAutomationAccess/></TabsContent>}
  </Tabs>;
}

function Requests({config,create}:{config:HelpdeskConfig;create:(category?:string)=>void}) {
  const [view,setView]=useState(config.canWorkQueue?'queue':'mine'),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[assignment,setAssignment]=useState('all'),[overdue,setOverdue]=useState(false),[search,setSearch]=useState(''),[term,setTerm]=useState(''),[page,setPage]=useState(1),[filtersOpen,setFiltersOpen]=useState(false),[allCategories,setAllCategories]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>{setTerm(search.trim());setPage(1);},300);return()=>clearTimeout(timer);},[search]);
  const list=useQuery<CaseList>({queryKey:['/api/helpdesk/cases',{view,status,category,assignment,overdue,q:term,page,limit:20}],refetchInterval:30000,refetchIntervalInBackground:false});
  const overview=useQuery<HelpdeskOverview>({queryKey:['/api/helpdesk/overview',{view}],refetchInterval:30000,refetchIntervalInBackground:false});
  const totals=overview.data,filtered=Boolean(status||category||assignment!=='all'||overdue||search),categories=config.workspace.categories.filter(c=>c.enabled);
  function clear(){setStatus('');setCategory('');setAssignment('all');setOverdue(false);setSearch('');setTerm('');setPage(1);}
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="view-switch" role="group" aria-label="Request scope">{config.canWorkQueue&&<button aria-pressed={view==='queue'} onClick={()=>{setView('queue');clear();}}>Team inbox</button>}<button aria-pressed={view==='mine'} onClick={()=>{setView('mine');clear();}}>My requests</button></div><Button variant="ghost" size="sm" aria-label="Refresh requests" disabled={list.isFetching||overview.isFetching} onClick={()=>{void list.refetch();void overview.refetch();}}><RefreshCw className={list.isFetching?'animate-spin':''}/>Refresh</Button></div>
    <QueryError error={overview.error}/>
    {overview.isLoading?<div role="status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0,1,2,3].map(i=><div key={i} className="h-28 rounded-2xl bg-muted/60 motion-safe:animate-pulse"/>)}<span className="sr-only">Loading overview</span></div>:!overview.error&&totals&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><MetricCard label="Requests" value={totals.total} icon={Inbox}/><MetricCard label="Active" value={totals.active} icon={Clock3}/><MetricCard label="Overdue" value={totals.overdue} icon={AlertCircle} tone="attention"/><MetricCard label="Completed" value={totals.completed} icon={CircleCheck} tone="positive"/></div>}
    <div className="helpdesk-grid">
      <section className="request-inbox">
        <div className="inbox-toolbar"><div className="flex items-center justify-between gap-3"><h2>{view==='mine'?'Your requests':'Team inbox'}{list.data&&!list.error&&<span className="inbox-count">{list.data.total}</span>}</h2><Button size="sm" variant="outline" aria-expanded={filtersOpen} aria-controls="request-filters" onClick={()=>setFiltersOpen(!filtersOpen)}><SlidersHorizontal/>Filters{filtered&&<span className="filter-dot"/>}</Button></div><label className="inbox-search"><Search aria-hidden="true"/><span className="sr-only">Search requests</span><input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Find a request…"/></label>
          {filtersOpen&&<div id="request-filters" className="space-y-3 pt-1"><div className="grid gap-3 sm:grid-cols-2"><Field label="Status"><select className={fieldClass} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{caseStatuses.map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}</select></Field><Field label="Category"><select className={fieldClass} value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}}><option value="">All categories</option>{config.workspace.categories.map(c=><option key={c.id} value={c.id}>{c.label}{c.enabled?'':' (inactive)'}</option>)}</select></Field>{view==='queue'&&<Field label="Handler"><select className={fieldClass} value={assignment} onChange={e=>{setAssignment(e.target.value);setPage(1);}}><option value="all">All handlers</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option></select></Field>}</div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={overdue} onChange={e=>{setOverdue(e.target.checked);setPage(1);}}/>Overdue only</label></div>}
          {filtered&&<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{[status&&statusLabels[status as keyof typeof statusLabels],category&&categoryName(config.workspace,category),assignment!=='all'&&(assignment==='mine'?'Assigned to me':'Unassigned'),overdue&&'Overdue',search&&`“${search}”`].filter(Boolean).join(' · ')}</span><button className="font-medium text-primary underline underline-offset-4" onClick={clear}>Clear</button></div>}
        </div>
        {list.isLoading?<p role="status" className="p-8 text-sm">Loading requests…</p>:list.error?<div className="p-5"><QueryError error={list.error}/><Button variant="outline" className="mt-3" onClick={()=>list.refetch()}>Try again</Button></div>:!list.data?.items.length?<div className="inbox-empty"><AnimatedIcon icon={LifeBuoy}/><h3>{filtered?'Nothing matches yet':'A clear inbox'}</h3><p>{filtered?'Try a different filter.':'We’re here when you need a hand.'}</p><Button variant="outline" onClick={()=>filtered?clear():create()}>{filtered?'Clear filters':'Ask HR'}</Button></div>:<ul className="request-list">{list.data.items.map(row=><li key={row.id}><RequestCard row={row} config={config}/></li>)}</ul>}
        {!list.error&&list.data&&<div className="inbox-pagination"><span>{list.data.total?`${(page-1)*20+1}–${Math.min(page*20,list.data.total)} of ${list.data.total}`:'0 requests'}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===1||list.isFetching} onClick={()=>setPage(page-1)}>Previous</Button><Button variant="outline" size="sm" disabled={page*20>=list.data.total||list.isFetching} onClick={()=>setPage(page+1)}>Next</Button></div></div>}
      </section>
      <aside className="space-y-4">
        <section className="support-shortcuts"><div className="flex items-center justify-between gap-2"><h2>What can we help with?</h2><AnimatedIcon icon={LifeBuoy}/></div><div className="category-grid">{(allCategories?categories:categories.slice(0,4)).map((c,i)=><button type="button" key={c.id} title={c.description||c.label} onClick={()=>create(c.id)} data-tone={i%4} className="category-shortcut"><AnimatedIcon icon={c.confidential?LockKeyhole:titleIcon(c.label)}/><span>{c.label}</span><ArrowUpRight className="category-arrow"/></button>)}</div>{categories.length>4&&<button className="category-more" aria-expanded={allCategories} onClick={()=>setAllCategories(!allCategories)}>{allCategories?'Show less':`All ${categories.length} topics`}<ChevronDown className={allCategories?'rotate-180':''}/></button>}</section>
        {!overview.error&&totals&&<section className="support-progress"><h2>Resolution snapshot</h2><ProgressRing value={totals.completed} total={totals.total} label="completed"/><div className="space-y-1">{caseStatuses.map((s,i)=><button key={s} aria-pressed={status===s} onClick={()=>{clear();setStatus(s);}} className="status-filter"><span style={{background:colors[i]}}/><span>{statusLabels[s]}</span><strong>{totals.statuses.find(row=>row.status===s)?.count||0}</strong></button>)}</div><p className="mt-3 text-[11px] text-muted-foreground">{view==='queue'?'Accessible team requests':'Your requests'} · all dates</p>{view==='queue'&&<div className="support-mini-stats"><span><strong>{totals.unassigned}</strong>Unassigned</span><span><strong>{totals.waiting}</strong>Awaiting reply</span></div>}</section>}
        {(config.workspace.introduction||config.workspace.contactInstructions)&&<HelpDisclosure title="About HR support">{config.workspace.introduction&&<p className="whitespace-pre-wrap">{config.workspace.introduction}</p>}{config.workspace.contactInstructions&&<p className="whitespace-pre-wrap">{config.workspace.contactInstructions}</p>}</HelpDisclosure>}
      </aside>
    </div>
  </div>;
}

function RequestCard({row,config}:{row:CaseSummary;config:HelpdeskConfig}) {
  const done=['resolved','closed'].includes(row.status);
  const responseLate=!done&&!row.firstRespondedAt&&row.firstResponseDueAt&&Date.parse(row.firstResponseDueAt)<Date.now();
  const late=!done&&row.resolutionDueAt&&Date.parse(row.resolutionDueAt)<Date.now();
  const initials=row.requesterName.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('');
  return <Link href={`/helpdesk/${row.id}`} className="request-card"><span className="request-avatar" aria-hidden="true">{initials}</span><span className="request-body"><span className="request-topline"><span className="request-ref">#{row.id} · {categoryName(config.workspace,row.category)}</span><span className="case-status" data-status={row.status}>{row.status==='waiting_employee'?'Awaiting reply':statusLabels[row.status]}</span></span><strong className="request-title">{row.title}</strong><span className="request-meta"><span>{row.requesterName}</span>{row.confidential&&<span><LockKeyhole className="h-3 w-3"/>Private</span>}<time>{stamp(row.updatedAt)}</time></span><span className="request-targets"><span>{row.assigneeName||'Unassigned'}</span>{!done&&!row.firstRespondedAt&&row.firstResponseDueAt&&<span className={responseLate?'text-destructive':''}><Clock3/>Reply {stamp(row.firstResponseDueAt)}{responseLate?' · overdue':''}</span>}{!done&&row.resolutionDueAt&&<span className={late?'text-destructive':''}>{late?'Resolution overdue':'Resolve by'} {stamp(row.resolutionDueAt)}</span>}</span></span><ArrowUpRight className="request-open" aria-hidden="true"/></Link>;
}
