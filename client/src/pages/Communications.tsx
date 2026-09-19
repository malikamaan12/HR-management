import {MessageCircle,AtSign,Megaphone,Inbox as InboxIcon} from 'lucide-react';
import {useHubSummary} from '@/components/communications/HubIndicator';
import { useState,useRef,useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs,TabsList,TabsTrigger,TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/hr/Operations';
import HubAnnouncements from '@/components/communications/HubAnnouncements';
import type {ChatDraft} from '@/components/communications/Conversation';
import HubChannels from '@/components/communications/HubChannels';
import { hub } from '@/components/communications/HubControls';
import type {HubContext} from '@shared/communications';
import HubInbox from '@/components/communications/HubInbox';
import HubPolicy from '@/components/communications/HubPolicy';
export default function Communications(){
  const [tab,setTab]=useState('channels'),[chatFilter,setChatFilter]=useState({value:'all',revision:0}),[focused,setFocused]=useState(false),[noticeFilter,setNoticeFilter]=useState({value:'all',revision:0});
  const top=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(focused)top.current?.closest('main')?.scrollTo({top:0});},[focused]);
  const drafts=useRef(new Map<number,ChatDraft>());
  const summary=useHubSummary();
  const context=useQuery<HubContext>({queryKey:[hub+'/context']});
  return <div ref={top} className={focused?"space-y-0":"space-y-6"}>{!focused&&<header><h1 className="text-3xl font-bold">Communication Hub</h1><p className="mt-2 text-muted-foreground">Connect with your team. Keep every shift, update and conversation in sync.</p></header>}<QueryError error={context.error}/>{!context.data&&!context.error&&<p>Loading your workspace…</p>}{context.data&&!context.error&&<>{!focused&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[{key:'unreadConversations',label:'Unread chats',target:'channels',Icon:MessageCircle},{key:'mentions',label:'Mentions',target:'channels',Icon:AtSign},{key:'pendingAcknowledgements',label:'Notices to acknowledge',target:'announcements',Icon:Megaphone},{key:'unreadActions',label:'Action inbox',target:'inbox',Icon:InboxIcon}].map(item=><button key={item.key} onClick={()=>{if(item.target==='channels')setChatFilter(value=>({value:item.key==='mentions'?'mentions':'unread',revision:value.revision+1}));if(item.target==='announcements')setNoticeFilter(value=>({value:'needs_ack',revision:value.revision+1}));setTab(item.target);}} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left hover:bg-accent"><span className="rounded-lg bg-primary/10 p-2 text-primary"><item.Icon className="h-4 w-4"/></span><span><strong className="block text-lg">{summary.error?'—':summary.data?.[item.key as keyof typeof summary.data]??'…'}</strong><span className="text-xs text-muted-foreground">{item.label}</span></span></button>)}</div>}<Tabs value={tab} onValueChange={setTab}>{!focused&&<TabsList className="flex h-auto w-fit max-w-full flex-wrap"><TabsTrigger value="channels">Team chat</TabsTrigger><TabsTrigger value="announcements">Announcements & briefings</TabsTrigger><TabsTrigger value="inbox">Action inbox</TabsTrigger>{context.data.canConfigure&&<TabsTrigger value="settings">Administration</TabsTrigger>}</TabsList>}<TabsContent value="announcements"><HubAnnouncements key={noticeFilter.revision} context={context.data} initialFilter={noticeFilter.value}/></TabsContent><TabsContent value="channels"><HubChannels context={context.data} filterRequest={chatFilter} drafts={drafts.current} focused={focused} onFocus={()=>setFocused(value=>!value)}/></TabsContent><TabsContent value="inbox"><HubInbox onAnnouncements={()=>{setNoticeFilter(value=>({value:'all',revision:value.revision+1}));setTab('announcements');}}/></TabsContent>{context.data.canConfigure&&<TabsContent value="settings"><HubPolicy key={context.data.policy.version} current={context.data.policy}/></TabsContent>}</Tabs></>}</div>;
}
