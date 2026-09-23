import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { MessageCircle, Megaphone, Inbox, Settings2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/hr/Operations';
import { useHubSummary } from '@/components/communications/HubIndicator';
import HubAnnouncements from '@/components/communications/HubAnnouncements';
import type { ChatDraft } from '@/components/communications/Conversation';
import HubChannels, { type OpenChat } from '@/components/communications/HubChannels';
import { hub } from '@/components/communications/HubControls';
import type { HubContext } from '@shared/communications';
import HubInbox from '@/components/communications/HubInbox';
import HubPolicy from '@/components/communications/HubPolicy';

export function CommunicationSettings() {
  const query = useQuery<HubContext>({ queryKey: [hub + '/context'] });
  return <><QueryError error={query.error}/>{query.isLoading && <p role="status">Loading communication rules…</p>}{query.data?.canConfigure && <HubPolicy key={query.data.policy.version} current={query.data.policy}/>}</>;
}

export default function Communications() {
  const [tab, setTab] = useState('channels');
  const [activeChat, setActiveChat] = useState<OpenChat | null>(null);
  const drafts = useRef(new Map<number, ChatDraft>());
  const summary = useHubSummary();
  const context = useQuery<HubContext>({ queryKey: [hub + '/context'] });
  const counts = summary.error ? undefined : summary.data;

  return <div className={`communication-hub ${tab === 'channels' ? 'messenger-root' : ''}`} data-chat-open={!!activeChat}>
    <h1 className="sr-only">Communication Hub</h1>
    <QueryError error={context.error}/>
    {!context.data && !context.error && <p role="status" className="p-6">Opening your chats…</p>}
    {context.data && !context.error && <Tabs value={tab} onValueChange={setTab} className="hub-tabs">
      <div className="hub-navigation">
        <TabsList aria-label="Communication Hub" className="hub-destinations">
          {[
            { id: 'channels', label: 'Chats', Icon: MessageCircle, count: counts?.unreadConversations },
            { id: 'announcements', label: 'Updates', Icon: Megaphone, count: counts?.pendingAcknowledgements },
            { id: 'inbox', label: 'Inbox', Icon: Inbox, count: counts?.unreadActions },
          ].map(({ id, label, Icon, count }) => <TabsTrigger key={id} value={id} className="gap-2">
            <Icon className="h-4 w-4" aria-hidden="true"/><span>{label}</span>
            {!!count && <span className="hub-count" aria-label={`${count} ${id === 'announcements' ? 'to acknowledge' : 'unread'}`}>{count > 99 ? '99+' : count}</span>}
          </TabsTrigger>)}
        </TabsList>
        {context.data.canConfigure && <Link href="/settings/communications" className="hub-settings" aria-label="Communication settings" title="Communication settings"><Settings2 className="h-4 w-4"/></Link>}
      </div>
      <TabsContent value="channels" className="hub-chat-panel">
        <HubChannels context={context.data} drafts={drafts.current} selected={activeChat} onSelect={setActiveChat}/>
      </TabsContent>
      <TabsContent value="announcements" className="pt-4"><HubAnnouncements context={context.data}/></TabsContent>
      <TabsContent value="inbox" className="pt-4"><HubInbox onAnnouncements={() => setTab('announcements')}/></TabsContent>
    </Tabs>}
  </div>;
}
