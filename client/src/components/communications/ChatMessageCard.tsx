import {useState} from 'react';
import {Bookmark,Pin,Reply,Smile,Paperclip,MessageSquare,MoreHorizontal} from 'lucide-react';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Button} from '@/components/ui/button';
import {chatReactions,type ChatMessage} from '@shared/communications';
import {hub,dateLabel} from './HubControls';
export const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase();
export function MessageCard({message:m,userId,canPost,canManage,busy,onReply,onThread,onAction,onWithdraw}:{message:ChatMessage;userId:number;canPost:boolean;canManage:boolean;busy:boolean;onReply:(m:ChatMessage)=>void;onThread:(id:number)=>void;onAction:(m:ChatMessage,action:string,body:unknown)=>void;onWithdraw:(m:ChatMessage)=>void}){
 const [reacting,setReacting]=useState(false),own=m.author_id===userId;
 return <article aria-label={`Message from ${m.author_name}`} className={`group flex gap-2.5 ${own?'flex-row-reverse':''}`}>
  <span aria-hidden="true" className={`mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold sm:flex ${own?'bg-primary/15 text-primary':'bg-violet-500/10 text-violet-600 dark:text-violet-300'}`}>{initials(m.author_name)}</span>
  <div className={`min-w-0 max-w-[94%] rounded-2xl border px-3 py-2.5 sm:max-w-[88%] ${own?'rounded-tr-sm border-primary/15 bg-primary/[0.07]':'rounded-tl-sm bg-card'}`}>
   <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><strong className="font-semibold">{own?'You':m.author_name}</strong><time className="text-muted-foreground" dateTime={m.created_at} title={dateLabel(m.created_at)}>{new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>{m.pinned&&<span className="flex items-center gap-1 text-primary"><Pin className="h-3 w-3"/>Pinned</span>}{m.saved&&<Bookmark aria-label="Saved for later" className="h-3 w-3 text-primary"/>}</div>
   {m.reply_preview&&<button className="mb-2 block w-full rounded-md border-l-2 border-primary bg-background/70 px-3 py-2 text-left text-xs" onClick={()=>onThread(m.reply_preview!.id)}><strong>{m.reply_preview.author_name}</strong><span className="mt-1 block line-clamp-2 break-words">{m.reply_preview.body}</span></button>}
   <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere] ${m.retracted_at?'italic text-muted-foreground':''}`}>{m.body}</p>
   {m.mentions.includes(userId)&&<span className="mt-2 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">@ You were mentioned</span>}
   {m.attachment_name&&<a className="mt-3 flex max-w-full items-center gap-2 rounded-lg border bg-background/70 p-2 text-xs hover:bg-accent" href={`${hub}/channels/${m.channel_id}/messages/${m.id}/file`} target="_blank" rel="noreferrer"><Paperclip className="h-4 w-4 shrink-0"/><span className="min-w-0 break-all">{m.attachment_name}<span className="block text-muted-foreground">{Math.ceil((m.attachment_size||0)/1024)} KB · Download</span></span></a>}
   {!m.retracted_at&&<>
    {!!m.reactions?.length&&<div className="mt-2 flex flex-wrap gap-1">{m.reactions.map(r=><button key={r.emoji} aria-label={`${r.emoji} reaction, ${r.count}, ${r.mine?'remove yours':'add yours'}`} aria-pressed={r.mine} disabled={busy||!canPost} onClick={()=>onAction(m,'reaction',{emoji:r.emoji,active:!r.mine})} className={`rounded-full border px-2 py-0.5 text-xs disabled:opacity-70 ${r.mine?'border-primary/40 bg-primary/10':'bg-background'}`}>{r.emoji} {r.count}</button>)}</div>}
    <div className="mt-2 flex flex-wrap items-center gap-1 text-muted-foreground">
     {canPost&&<><Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={()=>onReply(m)}><Reply className="h-3.5 w-3.5"/>Reply</Button><Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" aria-label={`React to message from ${m.author_name}`} aria-expanded={reacting} onClick={()=>setReacting(!reacting)}><Smile className="h-3.5 w-3.5"/></Button></>}
     {m.reply_count>0&&<Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-primary" onClick={()=>onThread(m.id)}><MessageSquare className="h-3.5 w-3.5"/>{m.reply_count} {m.reply_count===1?'reply':'replies'}</Button>}
     <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" className="h-7 px-2" aria-label={`More options for message from ${m.author_name}`}><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={busy} onSelect={()=>onAction(m,'save',{active:!m.saved})}><Bookmark className="mr-2 h-4 w-4"/>{m.saved?'Remove from saved':'Save for later'}</DropdownMenuItem>{canManage&&canPost&&<DropdownMenuItem disabled={busy} onSelect={()=>onAction(m,'pin',{active:!m.pinned})}><Pin className="mr-2 h-4 w-4"/>{m.pinned?'Unpin message':'Pin for everyone'}</DropdownMenuItem>}{(own||canManage)&&<DropdownMenuItem disabled={busy} onSelect={()=>onWithdraw(m)}>Withdraw message</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
    </div>
    {reacting&&canPost&&<div role="group" aria-label="Choose a reaction" className="mt-1 flex flex-wrap gap-1 rounded-lg bg-background p-1">{chatReactions.map(emoji=><button type="button" key={emoji} aria-label={`React ${emoji}`} disabled={busy} className="rounded-md p-2 text-base hover:bg-accent focus-visible:outline focus-visible:outline-primary" onClick={()=>{onAction(m,'reaction',{emoji,active:!m.reactions?.some(r=>r.emoji===emoji&&r.mine)});setReacting(false);}}>{emoji}</button>)}</div>}
   </>}
  </div>
 </article>;
}
