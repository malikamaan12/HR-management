import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, MessageSquarePlus, Search, Bookmark, Files, Star, AtSign, BellOff, Users, MoreHorizontal, UsersRound, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { QueryError } from '@/components/hr/Operations';
import { hub, Pager, type Page, useDebounced } from './HubControls';
import type { ChatChannel, HubContext } from '@shared/communications';
import Conversation, { type ChatDraft } from './Conversation';
import CreateChannel from './CreateChannel';
import ChatSearch from './ChatSearch';
import { initials } from './ChatMessageCard';

export type OpenChat = { id: number; message: number | null; name?: string };
function activityLabel(value: string) {
  const date = new Date(value), now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  return date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function HubChannels({ context, drafts, selected, onSelect }: {
  context: HubContext; drafts: Map<number, ChatDraft>; selected: OpenChat | null; onSelect: (chat: OpenChat | null) => void;
}) {
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [filter, setFilter] = useState('all');
  const [create, setCreate] = useState(''), [mode, setMode] = useState<'' | 'all' | 'saved' | 'files'>('');
  const search = useDebounced(q);
  const channels = useQuery<Page<ChatChannel>>({ queryKey: [`${hub}/channels?q=${encodeURIComponent(search)}&offset=${offset}&filter=${filter}`], refetchInterval: 10000, refetchIntervalInBackground: false });
  const current = channels.data?.items.find(c => c.id === selected?.id);
  const open = (id: number, message: number | null = null) => {
    onSelect({ id, message, name: channels.data?.items.find(c => c.id === id)?.display_name });
    setMode('');
  };
  const canCreateGroup = context.canManage;

  return <>
    <div className="messenger-workspace" data-selected={!!selected}>
      <aside aria-label="Conversation list" className="messenger-list">
        <div className="messenger-list-heading">
          <h2>Chats</h2>
          <div className="flex items-center gap-1">
            {context.policy.definition.directMessages && <Button size="icon" variant="secondary" aria-label="New message" title="New message" onClick={() => setCreate('direct')}><MessageSquarePlus className="h-5 w-5"/></Button>}
            <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Chat tools" title="Chat tools"><MoreHorizontal className="h-5 w-5"/></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canCreateGroup && <DropdownMenuItem onSelect={() => setCreate('group')}><UsersRound/>New group</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setMode('all')}><Search/>Search all messages</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMode('saved')}><Bookmark/>Saved messages</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMode('files')}><Files/>Shared files</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="px-4 pb-3">
          <label className="messenger-search"><Search className="h-4 w-4 shrink-0"/><input aria-label="Find conversations" placeholder="Search chats" value={q} maxLength={100} onChange={e => { setQ(e.target.value); setOffset(0); }}/></label>
          <div className="messenger-filters" aria-label="Filter chats">
            {[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'favorites', label: 'Favorites' }, { id: 'mentions', label: 'Mentions' }].map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setOffset(0); }}>{item.label}</button>)}
          </div>
        </div>
        <div className="messenger-chat-list">
          <QueryError error={channels.error}/>
          {channels.isLoading && <p role="status" className="p-4 text-sm text-muted-foreground">Loading chats…</p>}
          {!channels.error && channels.data?.items.map(c => <button key={c.id} onClick={() => open(c.id)} aria-pressed={selected?.id === c.id} className="messenger-chat-row">
            <span aria-hidden="true" className={`chat-avatar ${c.kind === 'direct' ? 'chat-avatar-person' : ''}`}>{c.kind === 'direct' ? initials(c.display_name) : <Users className="h-5 w-5"/>}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2"><strong className="min-w-0 flex-1 truncate text-sm" title={c.display_name}>{c.display_name}</strong>{c.last_activity && <time className={`shrink-0 text-[10px] ${c.unread && !c.muted ? 'text-primary' : 'text-muted-foreground'}`} dateTime={c.last_activity}>{activityLabel(c.last_activity)}</time>}</span>
              <span className="mt-1.5 flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.archived_at ? 'Archived · ' : ''}{drafts.get(c.id)?.body ? <><span className="text-primary">Draft: </span>{drafts.get(c.id)?.body}</> : c.last_message ? `${c.last_author ? c.last_author + ': ' : ''}${c.last_message}` : 'No messages yet'}</span>{c.favorite && <Star aria-label="Favorite" className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500"/>}{c.muted && <BellOff aria-label="Muted" className="h-3 w-3 shrink-0 text-muted-foreground"/>}{c.mentions > 0 && <AtSign aria-label={`${c.mentions} mentions`} className="h-3.5 w-3.5 shrink-0 text-primary"/>}{!c.muted && c.unread > 0 && <span className="chat-unread" aria-label={`${c.unread} unread messages`}>{c.unread > 99 ? '99+' : c.unread}</span>}</span>
            </span>
          </button>)}
          {!channels.error && channels.data && !channels.data.items.length && <div className="px-5 py-12 text-center"><MessageCircle className="mx-auto mb-3 h-8 w-8 text-primary/50"/><p className="text-sm font-medium">{filter === 'unread' ? 'You’re all caught up' : q ? 'No chats found' : filter === 'favorites' ? 'No favorites yet' : 'No conversations here'}</p><p className="mt-1 text-xs text-muted-foreground">{filter === 'favorites' ? 'Star a chat from its menu to keep it close.' : 'Try another filter or start a message.'}</p></div>}
        </div>
        {(offset > 0 || channels.data?.hasMore) && <div className="border-t p-3"><Pager offset={offset} hasMore={channels.data?.hasMore} onChange={setOffset}/></div>}
      </aside>
      {selected ? <Conversation key={selected.id} id={selected.id} userId={context.userId} displayName={current?.display_name || selected.name} focusMessage={selected.message} onBack={() => onSelect(null)} drafts={drafts}/> : <div className="messenger-welcome">
        <div className="messenger-welcome-art" aria-hidden="true"><MessageCircle/><span><UsersRound/></span></div>
        <h2>Your team, one conversation away</h2>
        <p>Choose a chat or say hello to someone new.</p>
        {context.policy.definition.directMessages && <Button className="mt-6 gap-2" onClick={() => setCreate('direct')}><MessageSquarePlus className="h-4 w-4"/>New message</Button>}
        <a href="/helpdesk" className="mt-10 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">Need HR support?<ArrowUpRight className="h-3 w-3"/></a>
      </div>}
    </div>
    <Dialog open={!!create} onOpenChange={value => { if (!value) setCreate(''); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{create === 'direct' ? 'New message' : 'New group'}</DialogTitle></DialogHeader>{create && <CreateChannel key={create} mode={create} onDone={id => { setCreate(''); open(id); }}/>}</DialogContent></Dialog>
    <Dialog open={!!mode} onOpenChange={value => { if (!value) setMode(''); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{mode === 'saved' ? 'Saved messages' : mode === 'files' ? 'Shared files' : 'Search messages'}</DialogTitle></DialogHeader>{mode && <ChatSearch key={mode} mode={mode} onOpen={open}/>}</DialogContent></Dialog>
  </>;
}
