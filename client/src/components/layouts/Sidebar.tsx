import {BrandLogo,useBranding} from '@/components/Branding';
import {defaultPublicBranding} from '@shared/branding';
import {ModuleIcon} from '@/components/ux/ModuleVisuals';
import {ChevronDown,LogOut,Menu,X,House,MessagesSquare,Clock3,LifeBuoy,Search} from 'lucide-react';
import {useState,useEffect} from 'react';
import {Link,useLocation} from 'wouter';
import {useAuth} from '@/contexts/AuthContext';
import {usePageAccess} from '@/hooks/usePageAccess';
import {pageForPath,pageLabel,roleLabel} from '@shared/navigation';
import {cn} from '@/lib/utils';
import {AnimatedIcon} from '@/components/ux/ExperienceUI';
export default function Sidebar({className}:{className?:string}){
 const {data:branding=defaultPublicBranding}=useBranding();
 const [location]=useLocation(),[open,setOpen]=useState(false),[search,setSearch]=useState('');
 const {logout}=useAuth(),{user,pages}=usePageAccess();
 const [collapsed,setCollapsed]=useState<Record<string,boolean>>(()=>Object.fromEntries(pages.map(page=>[page.section,page.section!=='Workspace'&&page.section!==pageForPath(location)?.section])));
 const filtered=pages.filter(p=>pageLabel(p,user!.role).toLowerCase().includes(search.toLowerCase()));
 const dock=[{href:'/',label:'Home',icon:House},{href:'/communications',label:'Team',icon:MessagesSquare},{href:'/attendance',label:'Time',icon:Clock3},{href:'/helpdesk',label:'Help',icon:LifeBuoy}].filter(item=>pages.some(page=>page.href===item.href));
 useEffect(()=>{setOpen(false);setSearch('');const section=pageForPath(location)?.section;if(section)setCollapsed(current=>({...current,[section]:false}));},[location]);
 useEffect(()=>{if(open)document.getElementById('module-search')?.focus();},[open]);
 useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);document.getElementById('sidebarToggle')?.focus();}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[]);
 return <>
 <nav aria-label="Quick navigation" className="mobile-dock md:hidden">{dock.map(item=><Link key={item.href} href={item.href} onClick={()=>setOpen(false)} aria-current={pageForPath(location)?.href===item.href?'page':undefined}><AnimatedIcon icon={item.icon}/><span>{item.label}</span></Link>)}<button id="sidebarToggle" aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} aria-controls="sidebar" onClick={()=>setOpen(!open)}><AnimatedIcon icon={open?X:Menu}/><span>{open?'Close':'Explore'}</span></button></nav>
 {open&&<button aria-label="Close navigation backdrop" onClick={()=>setOpen(false)} className="md:hidden fixed inset-0 z-30 bg-black/40"/>}
 <aside id="sidebar" role={open?'dialog':undefined} aria-modal={open?true:undefined} aria-label="Workspace navigation" onKeyDown={event=>{
 if(!open||event.key!=='Tab')return;
 const focusable=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a,button,input')).filter(element=>element.offsetParent!==null);
 const first=focusable[0],last=focusable[focusable.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }} className={cn('workspace-sidebar fixed md:sticky top-0 left-0 z-40 w-60 h-dvh shrink-0 border-r bg-card text-foreground flex-col',open?'flex':'hidden md:flex',className)}>
 <div className="sidebar-brand"><Link href="/" className="flex min-w-0 flex-1 items-center gap-3"><BrandLogo appearance="dark"/><span className="min-w-0"><span className="block font-semibold break-words">{branding.applicationName}</span><span className="sidebar-tagline" title={branding.tagline}>{branding.tagline}</span></span></Link>{open&&<button className="md:hidden p-2" aria-label="Close menu" onClick={()=>{setOpen(false);document.getElementById('sidebarToggle')?.focus();}}><X className="h-4 w-4"/></button>}</div>
 <div className="px-4 pb-4"><label htmlFor="module-search" className="sidebar-search"><Search aria-hidden="true" className="h-4 w-4"/><span className="sr-only">Find a module</span><input id="module-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find anything…"/></label></div>
 <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 pb-3">{[...new Set(filtered.map(p=>p.section))].map(section=><section key={section} className="mb-2"><h2><button type="button" className="nav-group-toggle" aria-expanded={!!search||!collapsed[section]} onClick={()=>setCollapsed(current=>({...current,[section]:!current[section]}))}>{section}<ChevronDown aria-hidden="true" className={cn("h-3 w-3 transition-transform",collapsed[section]&&!search&&"-rotate-90")}/></button></h2><ul hidden={!!collapsed[section]&&!search} className="space-y-0.5">{filtered.filter(p=>p.section===section).map(p=><li key={p.href}><Link href={p.href} data-section={p.section} aria-current={pageForPath(location)?.href===p.href?'page':undefined} className={cn('module-nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',pageForPath(location)?.href===p.href&&'bg-primary/10 text-primary font-semibold')}><span className="nav-icon"><ModuleIcon name={p.icon}/></span>{pageLabel(p,user!.role)}</Link></li>)}</ul></section>)}{!filtered.length&&<p role="status" className="p-3 text-sm text-muted-foreground">No accessible modules match your search.</p>}</nav>
 <div className="flex items-center gap-3 border-t p-4"><Link href="/account" className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user?.firstName} {user?.lastName}</span><span className="text-xs text-muted-foreground">{user&&roleLabel(user.role)}</span></Link><button aria-label="Log out" onClick={()=>void logout()} className="p-2 rounded hover:bg-accent"><LogOut aria-hidden="true" className="h-4 w-4"/></button></div>
 </aside></>;
}
