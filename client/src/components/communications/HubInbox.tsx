import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox, CheckCheck, Mail, MailOpen, ArrowUpRight, RefreshCw, Search, ClipboardCheck, GraduationCap, LifeBuoy, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QueryError, fieldClass } from '@/components/hr/Operations';
import { usePageAccess } from '@/hooks/usePageAccess';
import type { InboxItem } from '@shared/communications';
import { hub, useHubAction, useDebounced, Pager, dateLabel, type Page } from './HubControls';
import { FilterPills } from './NoticeVisuals';

export default function HubInbox({ onAnnouncements }: { onAnnouncements: () => void }) {
  const [filter, setFilter] = useState('unread'), [q, setQ] = useState(''), [offset, setOffset] = useState(0), [selected, setSelected] = useState<number[]>([]);
  const search = useDebounced(q), { pages } = usePageAccess();
  const result = useQuery<Page<InboxItem>>({ queryKey: [`${hub}/inbox?filter=${filter}&q=${encodeURIComponent(search)}&offset=${offset}`], refetchInterval: 30000, refetchIntervalInBackground: false });
  const action = useHubAction(() => setSelected([]));
  const items = result.error ? [] : result.data?.items || [], unread = items.filter(item => !item.read_at);
  const selectedUnread = selected.filter(id => unread.some(item => item.id === id));
  const shortcuts = [{ href: '/team-overview', title: 'Team approvals', text: 'Review work that needs a decision', Icon: ClipboardCheck }, { href: '/helpdesk', title: 'My HR cases', text: 'Follow up with HR', Icon: LifeBuoy }, { href: '/learning', title: 'My training', text: 'Check learning and required courses', Icon: GraduationCap }].filter(item => pages.some(page => page.href === item.href));
  return <div className="space-y-5">
    <div><h2 className="text-xl font-semibold">Inbox</h2><p className="mt-1 text-sm text-muted-foreground">Your reminders and next steps.</p></div>
    <div className="flex flex-wrap gap-2">{shortcuts.map(item=><Button key={item.href} size="sm" variant="outline" asChild><a href={item.href} className="gap-2"><item.Icon className="h-4 w-4"/>{item.title}</a></Button>)}<Button size="sm" variant="outline" className="gap-2" onClick={onAnnouncements}><Megaphone className="h-4 w-4"/>Updates</Button></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><FilterPills label="Inbox status" value={filter} onChange={value => { setFilter(value); setOffset(0); setSelected([]); }} items={[{ value: 'unread', label: 'Unread' }, { value: 'all', label: 'All reminders' }, { value: 'read', label: 'Read' }]}/><Button variant="outline" size="sm" onClick={() => void result.refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${result.isFetching ? 'animate-spin' : ''}`}/>Refresh inbox</Button></div>
    <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><input className={fieldClass + ' pl-9'} aria-label="Search action inbox" placeholder="Search your reminders…" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); setSelected([]); }}/></div>
    <QueryError error={result.error || action.error}/>{result.isLoading && <p role="status">Loading reminders…</p>}
    {!result.error && !!unread.length && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 px-4 py-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedUnread.length === unread.length} disabled={action.isPending} onChange={e => setSelected(e.target.checked ? unread.map(item => item.id) : [])}/>Select unread on this page</label><Button size="sm" variant="outline" disabled={!selectedUnread.length || action.isPending} onClick={() => action.mutate({ path: '/inbox/read', body: { ids: selectedUnread } })}><CheckCheck className="mr-2 h-4 w-4"/>Mark selected read{selectedUnread.length ? ` (${selectedUnread.length})` : ''}</Button></div>}
    {!result.error && result.data && !items.length && <div className="rounded-2xl border bg-card px-6 py-14 text-center"><Inbox className="mx-auto mb-4 h-10 w-10 text-primary/60"/><h3 className="font-semibold">{filter === 'unread' && !q ? 'Your inbox is clear' : 'No reminders match'}</h3><p className="mt-2 text-sm text-muted-foreground">{filter === 'unread' && !q ? 'New workflow reminders will appear here when they need your attention.' : 'Try another filter or search phrase.'}</p></div>}
    <div className="space-y-3">{items.map(item => { const pathname = item.url?.split('?')[0]; const related = pages.find(page => pathname === page.href || pathname?.startsWith(page.href + '/')); return <article key={item.id} className={`flex items-start gap-3 rounded-xl border bg-card p-4 sm:gap-4 ${!item.read_at ? 'border-l-4 border-l-primary' : ''}`}>
      {!item.read_at ? <input className="mt-1.5" type="checkbox" aria-label={`Select reminder: ${item.message}`} disabled={action.isPending} checked={selectedUnread.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))}/> : <MailOpen className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"/>}
      <div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant={item.read_at ? 'outline' : 'secondary'}>{item.read_at ? 'Read' : 'Unread'}</Badge><span className="text-xs text-muted-foreground">{dateLabel(item.timestamp)}</span>{item.channel !== 'push' && <span className="text-xs text-muted-foreground">Historical notification</span>}</div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{item.message}</p><div className="mt-3 flex flex-wrap gap-2">{item.url && related && <Button size="sm" variant="outline" asChild><a className="gap-2" href={item.url}>{related.label}<ArrowUpRight className="h-3.5 w-3.5"/></a></Button>}<Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ path: `/inbox/${item.id}/${item.read_at ? 'unread' : 'read'}`, body: {} })}>{item.read_at ? <Mail className="mr-2 h-3.5 w-3.5"/> : <CheckCheck className="mr-2 h-3.5 w-3.5"/>}{item.read_at ? 'Mark unread' : 'Mark read'}</Button></div></div>
    </article>; })}</div>
    {(offset > 0 || result.data?.hasMore) && <Pager offset={offset} hasMore={!result.error && result.data?.hasMore} onChange={value => { setOffset(value); setSelected([]); }}/>}
    <p className="text-xs text-muted-foreground">Reading a reminder only updates your inbox. Complete or approve the task in its original module.</p>
  </div>;
}
