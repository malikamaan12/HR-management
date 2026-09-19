import {ModuleIcon} from '@/components/ux/ModuleVisuals';
import {useState,useEffect} from 'react';
import {Link,useLocation} from 'wouter';
import {useAuth} from '@/contexts/AuthContext';
import {usePageAccess} from '@/hooks/usePageAccess';
import {pageForPath,pageLabel,roleLabel} from '@shared/navigation';
import {cn} from '@/lib/utils';
export default function Sidebar({className}:{className?:string}){
 const [location]=useLocation(),[open,setOpen]=useState(false),[search,setSearch]=useState('');
 const {logout}=useAuth(),{user,pages}=usePageAccess();
 const filtered=pages.filter(p=>pageLabel(p,user!.role).toLowerCase().includes(search.toLowerCase()));
 useEffect(()=>{setOpen(false);setSearch('');},[location]);
 useEffect(()=>{if(open)document.getElementById('module-search')?.focus();},[open]);
 useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);document.getElementById('sidebarToggle')?.focus();}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[]);
 return <>
 <button id="sidebarToggle" aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} aria-controls="sidebar" onClick={()=>setOpen(!open)} className="md:hidden fixed bottom-4 right-4 z-50 rounded-full bg-primary text-primary-foreground w-12 h-12 shadow-lg"><i aria-hidden="true" className={`fas fa-${open?'times':'bars'}`}/></button>
 {open&&<button aria-label="Close navigation backdrop" onClick={()=>setOpen(false)} className="md:hidden fixed inset-0 z-30 bg-black/40"/>}
 <aside id="sidebar" aria-label="Workspace navigation" onKeyDown={event=>{
 if(!open||event.key!=='Tab')return;
 const focusable=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a,button,input'));
 const first=focusable[0],last=focusable[focusable.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }} className={cn('fixed md:sticky top-0 left-0 z-40 w-64 h-dvh shrink-0 border-r bg-background text-foreground flex-col',open?'flex':'hidden md:flex',className)}>
 <Link href="/" className="flex items-center gap-3 border-b p-4"><span className="rounded-lg bg-primary p-2 font-bold text-primary-foreground">E3</span><span><span className="block font-semibold">E3 HR System</span><span className="text-xs text-muted-foreground">People & operations</span></span></Link>
 <div className="p-3 pb-0"><label htmlFor="module-search" className="sr-only">Find a module</label><input id="module-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a module…" className="w-full rounded-md border bg-background px-3 py-2 text-sm"/></div>
 <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3">{[...new Set(filtered.map(p=>p.section))].map(section=><section key={section} className="mb-4"><h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section}</h2><ul className="space-y-1">{filtered.filter(p=>p.section===section).map(p=><li key={p.href}><Link href={p.href} data-section={p.section} aria-current={pageForPath(location)?.href===p.href?'page':undefined} className={cn('module-nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',pageForPath(location)?.href===p.href&&'bg-primary/10 text-primary font-semibold')}><span className="nav-icon"><ModuleIcon name={p.icon}/></span>{pageLabel(p,user!.role)}</Link></li>)}</ul></section>)}{!filtered.length&&<p role="status" className="p-3 text-sm text-muted-foreground">No accessible modules match your search.</p>}</nav>
 <div className="flex items-center gap-3 border-t p-4"><Link href="/account" className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user?.firstName} {user?.lastName}</span><span className="text-xs text-muted-foreground">{user&&roleLabel(user.role)}</span></Link><button aria-label="Log out" onClick={()=>void logout()} className="p-2 rounded hover:bg-accent"><i aria-hidden="true" className="fas fa-sign-out-alt"/></button></div>
 </aside></>;
}
