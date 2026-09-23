import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Plus, Search, RefreshCw, Users, Calendar, Pin, CheckCheck, ArrowUpRight, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QueryError, fieldClass } from '@/components/hr/Operations';
import { hub, Pager, useDebounced, dateLabel, type Page } from './HubControls';
import { FilterPills, NoticeStage, noticeStages } from './NoticeVisuals';
import AnnouncementEditor from './AnnouncementEditor';
import AnnouncementDetail from './AnnouncementDetail';
import type { BulletinOverview, BulletinView, HubContext } from '@shared/communications';

export default function HubAnnouncements({ context, initialFilter = 'all' }: { context: HubContext; initialFilter?: string }) {
  const [managed, setManaged] = useState(false), [filter, setFilter] = useState(initialFilter);
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [selected, setSelected] = useState<number | null>(null), [create, setCreate] = useState(false);
  const search = useDebounced(q);
  const overview = useQuery<BulletinOverview>({ queryKey: [hub + '/bulletins/overview'], refetchInterval: 30000, refetchIntervalInBackground: false });
  const items = useQuery<Page<BulletinView>>({ queryKey: [`${hub}/bulletins?managed=${managed}&filter=${filter}&q=${encodeURIComponent(search)}&offset=${offset}`], refetchInterval: 30000, refetchIntervalInBackground: false });
  const changeFilter = (value: string) => { setFilter(value); setOffset(0); };
  const counts = overview.error ? undefined : overview.data;
  if (create) return <AnnouncementEditor context={context} onCancel={() => setCreate(false)} onDone={id => { setCreate(false); setSelected(id); setManaged(true); changeFilter('draft'); }}/>;
  if (selected) return <AnnouncementDetail key={selected} id={selected} context={context} onClose={() => setSelected(null)}/>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Updates</h2><p className="mt-1 text-sm text-muted-foreground">Company news and team announcements.</p></div>{context.canManage && <Button className="gap-2" onClick={() => setCreate(true)}><Plus className="h-4 w-4"/>Create update</Button>}</div>
    <FilterPills label="Announcement filters" value={managed?'':filter} onChange={value=>{setManaged(false);changeFilter(value);}} items={[
      {value:'all',label:'For you',count:counts?.mine.all}, {value:'unread',label:'Unread',count:counts?.mine.unread},
      {value:'needs_ack',label:'To acknowledge',count:counts?.mine.needs_ack}, {value:'pinned',label:'Pinned',count:counts?.mine.pinned},
    ]}/>
    {context.canManage && <div className="flex w-fit gap-1 rounded-xl border bg-card p-1"><Button size="sm" variant={!managed ? 'secondary' : 'ghost'} aria-pressed={!managed} onClick={() => { setManaged(false); changeFilter('all'); }}><Megaphone className="mr-2 h-4 w-4"/>For me</Button><Button size="sm" variant={managed ? 'secondary' : 'ghost'} aria-pressed={managed} onClick={() => { setManaged(true); changeFilter('all'); }}><LayoutGrid className="mr-2 h-4 w-4"/>Publishing board</Button></div>}
    {managed && <FilterPills label="Publication status" value={filter} onChange={changeFilter} items={[{ value: 'all', label: 'All publications' }, ...Object.entries(noticeStages).map(([value, item]) => ({ value, label: item.label, count: counts?.managed[value as BulletinView['stage']] ?? 0 }))]}/>}
    <div className="flex items-center gap-3"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><input className={fieldClass + ' pl-9'} aria-label="Search announcements" placeholder="Search updates…" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }}/></div><Button size="icon" variant="outline" aria-label="Refresh announcements" onClick={() => { void items.refetch(); void overview.refetch(); }}><RefreshCw className={`h-4 w-4 ${items.isFetching ? 'animate-spin' : ''}`}/></Button></div>
    <QueryError error={items.error || overview.error}/>
    {items.isLoading && <p role="status" className="py-8 text-center text-muted-foreground">Loading notices…</p>}
    {!items.error && items.data && !items.data.items.length && <div className="rounded-2xl border bg-card px-6 py-12 text-center"><CheckCheck className="mx-auto mb-4 h-10 w-10 text-primary/60"/><h3 className="font-semibold">{filter === 'needs_ack' || filter === 'unread' ? 'You’re all caught up' : 'No announcements here yet'}</h3><p className="mt-2 text-sm text-muted-foreground">{q ? 'Try a different search or filter.' : managed ? 'Start a draft, choose its audience and review it before publishing.' : 'Notices addressed to you will appear here when published.'}</p></div>}
    <div className="grid gap-4 md:grid-cols-2">{!items.error && items.data?.items.map(b => <article key={b.id} className={`flex flex-col rounded-2xl border bg-card p-5 ${b.pinned ? 'border-primary/30' : ''}`}>
      <div className="mb-3 flex flex-wrap gap-2"><NoticeStage stage={b.stage}/>{b.pinned && <Badge variant="secondary" className="gap-1"><Pin className="h-3 w-3"/>Pinned</Badge>}{!managed && !b.read_at && <Badge>Unread</Badge>}</div>
      <h3 className="break-words text-lg font-semibold">{b.title}</h3><p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{b.body}</p>
      <div className="mt-4 space-y-2 text-xs text-muted-foreground"><p className="flex items-center gap-2"><Users className="h-3.5 w-3.5 shrink-0"/><span className="truncate">{b.audience_label}</span></p><p className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 shrink-0"/>{dateLabel(b.publish_at)}</p></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3"><span className="text-xs">{b.requires_acknowledgement ? !managed && b.acknowledged_at ? 'Acknowledged ✓' : 'Acknowledgement required' : 'For information'}</span><Button size="sm" variant="outline" className="gap-2" onClick={() => setSelected(b.id)}>{managed ? 'Review notice' : 'Read notice'}<ArrowUpRight className="h-3.5 w-3.5"/></Button></div>
    </article>)}</div>
    {(offset > 0 || items.data?.hasMore) && <Pager offset={offset} hasMore={!items.error && items.data?.hasMore} onChange={setOffset}/>}
  </div>;
}
