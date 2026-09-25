import {AnimatedIcon} from './ExperienceUI';
import {useLocale} from '@/contexts/LocaleContext';
import {useId, type ReactNode} from 'react';
import {ChevronDown, type LucideIcon} from 'lucide-react';
import {cn} from '@/lib/utils';

export function PageHeading({title,description,actions,icon:Icon}:{title:string;description?:string;actions?:ReactNode;icon?:LucideIcon}) {
  const {t}=useLocale();
  return <header className="workspace-heading"><div className="flex min-w-0 items-center gap-3">{Icon&&<span className="workspace-heading-icon"><AnimatedIcon icon={Icon}/></span>}<div><h1>{t(title)}</h1>{description&&<p>{t(description)}</p>}</div></div>{actions&&<div className="flex flex-wrap items-center gap-2">{actions}</div>}</header>;
}

export function HelpDisclosure({title='How it works',children}:{title?:string;children:ReactNode}) {
  return <details className="help-disclosure"><summary><span>{title}</span><ChevronDown aria-hidden="true" className="h-4 w-4"/></summary><div className="space-y-2 pt-3 text-sm text-muted-foreground">{children}</div></details>;
}

const colors=['bg-teal-600 dark:bg-teal-400','bg-blue-500','bg-amber-500','bg-violet-500','bg-rose-500','bg-slate-400'];
export function DistributionCard({title,items,description}:{title:string;items:{label:string;value:number}[];description?:string}) {
  const id=useId(), total=items.reduce((sum,item)=>sum+Math.max(0,item.value),0);
  return <section className="distribution-card" aria-labelledby={id}><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id={id} className="text-sm font-semibold">{title}</h2><span className="text-xs text-muted-foreground">{description||`${total.toLocaleString()} records`}</span></div>{total>0?<><div className="my-4 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">{items.map((item,i)=>item.value>0&&<span key={item.label} className={colors[i%colors.length]} style={{width:`${item.value/total*100}%`}}/>)}</div><ul className="flex flex-wrap gap-x-5 gap-y-2">{items.map((item,i)=><li key={item.label} className="flex items-center gap-2 text-xs"><span aria-hidden="true" className={cn('h-2 w-2 rounded-full',colors[i%colors.length])}/><span className="text-muted-foreground">{item.label}</span><strong className="tabular-nums">{item.value.toLocaleString()}</strong></li>)}</ul></>:<p className="mt-3 text-sm text-muted-foreground">No records in this selection.</p>}</section>;
}
