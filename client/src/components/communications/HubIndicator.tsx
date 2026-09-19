import {useQuery} from '@tanstack/react-query';
import {MessageCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {HubSummary} from '@shared/communications';
import {hub} from './HubControls';
export function useHubSummary(){return useQuery<HubSummary>({queryKey:[hub+'/summary'],refetchInterval:30000,refetchIntervalInBackground:false});}
export default function HubIndicator({onOpen}:{onOpen:()=>void}){
 const summary=useHubSummary(),count=summary.error?0:(summary.data?.unreadConversations||0)+(summary.data?.pendingAcknowledgements||0)+(summary.data?.unreadActions||0);
 return <Button variant="ghost" size="icon" className="relative" aria-label={count?`Open communication hub, ${count} items need attention`:'Open communication hub'} onClick={onOpen}><MessageCircle className="h-5 w-5"/>{count>0&&<span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">{count>99?'99+':count}</span>}</Button>;
}
