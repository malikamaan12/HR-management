import {AnimatedIcon,Reveal} from './ExperienceUI';
import type {ReactNode} from 'react';
import {Link} from 'wouter';
import {Inbox,Activity,Archive,ArrowRight,BarChart3,BookOpen,Briefcase,CalendarDays,CheckCircle2,ClipboardCheck,Clock,FileText,GraduationCap,Heart,HelpCircle,LayoutDashboard,MapPin,MessageCircle,Network,Receipt,Search,Settings,ShieldCheck,Sparkles,Users,Wallet,AlertCircle,Upload,UserRound, type LucideIcon} from 'lucide-react';
import {cn} from '@/lib/utils';
const moduleIcons:Record<string,LucideIcon>={gauge:LayoutDashboard,user:UserRound,comments:MessageCircle,'life-ring':HelpCircle,users:Users,sitemap:Network,'user-plus':Users,'clipboard-list':ClipboardCheck,briefcase:Briefcase,'people-group':Users,'people-carry':Users,'id-badge':Briefcase,'calendar-check':CalendarDays,clock:Clock,'umbrella-beach':CalendarDays,'money-check-alt':Wallet,heart:Heart,receipt:Receipt,'file-alt':FileText,'file-signature':FileText,laptop:Briefcase,book:BookOpen,'graduation-cap':GraduationCap,'chart-line':Activity,star:Sparkles,'chart-bar':BarChart3,archive:Archive,upload:Upload,'user-shield':ShieldCheck,'sliders-h':Settings,'list-check':ClipboardCheck,bell:Clock,cog:Settings};
export function ModuleIcon({name,className}:{name:string;className?:string}){const Icon=moduleIcons[name]||LayoutDashboard;return <Icon aria-hidden="true" className={cn('h-5 w-5 shrink-0',className)}/>;}
export function titleIcon(title:string):LucideIcon{
 if(/pay|salary|compensation|payment/i.test(title))return Wallet;
 if(/benefit|wellbeing/i.test(title))return Heart;
 if(/expense|claim|reimburse/i.test(title))return Receipt;
 if(/approv|readiness|checklist|compliance/i.test(title))return ClipboardCheck;
 if(/leave|absence|calendar|shift/i.test(title))return CalendarDays;
 if(/time|attendance|deadline|reminder/i.test(title))return Clock;
 if(/learn|training|course|induction|qualification/i.test(title))return GraduationCap;
 if(/report|trend|analytic|summary/i.test(title))return BarChart3;
 if(/document|letter|record|history|template/i.test(title))return FileText;
 if(/team|staff|employee|people|candidate|recruit|owner/i.test(title))return Users;
 if(/access|account|security|role/i.test(title))return ShieldCheck;
 if(/location|site|venue/i.test(title))return MapPin;
 if(/message|communication|channel/i.test(title))return MessageCircle;
 if(/setting|rule|policy|configuration/i.test(title))return Settings;
 if(/task|review|performance/i.test(title))return ClipboardCheck;
 return LayoutDashboard;
}
export function TitleIcon({title}:{title:string}){const Icon=titleIcon(title);return <span className="section-icon"><Icon aria-hidden="true" className="h-5 w-5"/></span>;}
const statusTones:Record<string,string>={active:'positive',approved:'positive',completed:'positive',paid:'positive',published:'positive',verified:'positive',valid:'positive',ready:'positive',pending:'attention',submitted:'attention',in_progress:'attention',on_hold:'attention',expiring:'attention',draft:'neutral',open:'neutral',inactive:'neutral',archived:'neutral',cancelled:'neutral',rejected:'negative',expired:'negative',revoked:'negative',frozen:'negative',overdue:'negative',returned:'attention'};
const statusClasses:Record<string,string>={positive:'status-positive',attention:'status-attention',neutral:'status-neutral',negative:'status-negative'};
export function StatusPill({value}:{value:string}){const key=value.toLowerCase().replaceAll(' ','_');const tone=statusTones[key]||({processed:'positive',fulfilled:'positive',reimbursed:'positive',acknowledged:'positive',submitted:'attention',issued:'attention',return_requested:'attention',available:'positive',maintenance:'attention',lost:'negative',on_leave:'attention',expiring_soon:'attention',screening:'attention',shortlisted:'positive'} as Record<string,string>)[key];if(!tone)return <>{value}</>;return <span className={cn('status-pill',statusClasses[tone])}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"/>{value.replaceAll('_',' ')}</span>;}
export function MetricCard({label,value,detail,icon:Icon=BarChart3,tone='primary'}:{label:string;value:ReactNode;detail?:string;icon?:LucideIcon;tone?:'primary'|'positive'|'attention'}){return <Reveal className={cn('metric-card','metric-'+tone)}><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-muted-foreground">{label}</p><AnimatedIcon icon={Icon}/></div><p className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">{value}</p>{detail&&<p className="mt-2 text-xs text-muted-foreground">{detail}</p>}</Reveal>;}
export function EmptyState({title,description}:{title:string;description?:string}){return <div className="empty-state"><span className="rounded-full bg-muted p-3"><Inbox aria-hidden="true" className="h-6 w-6 text-muted-foreground"/></span><p className="font-medium">{title}</p>{description&&<p className="max-w-md text-sm text-muted-foreground">{description}</p>}</div>;}
export function ActionLink({href,children}:{href:string;children:ReactNode}){return <Link href={href} className="action-link">{children}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0"/></Link>;}
export function FlowSteps({steps}:{steps:string[]}){return <ol aria-label="Workflow steps" className="workflow-steps">{steps.map((step,i)=><li key={step}><span aria-hidden="true">{i+1}</span>{step}</li>)}</ol>;}
