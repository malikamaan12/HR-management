import {lazy,Suspense,useState,type ReactNode} from 'react';
import {Link,useLocation,useRoute} from 'wouter';
import {ArrowLeft,ArrowUpRight,Archive,Bell,BookOpen,BriefcaseBusiness,Building2,Calculator,CalendarDays,CheckCheck,ClipboardList,Clock3,FileCheck2,FileText,Gift,GraduationCap,HeartHandshake,LifeBuoy,Fingerprint,MessagesSquare,Network,Palette,Receipt,Search,Settings2,ShieldCheck,SlidersHorizontal,Users,Wallet,X,ChartNoAxesCombined,type LucideIcon} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {ExperienceHero,AnimatedIcon,Reveal} from '@/components/ux/ExperienceUI';
import {cn} from '@/lib/utils';

const Wps=lazy(()=>import('@/components/settings/WpsSettings'));
const Company=lazy(()=>import('@/components/settings/CompanySettings'));
const Branding=lazy(()=>import('@/components/BrandingSettings'));
const Rules=lazy(()=>import('@/pages/HrRules'));
const Calculations=lazy(()=>import('@/components/CalculationRules'));
const Devices=lazy(()=>import('@/components/settings/DeviceConnections'));
const Teams=lazy(()=>import('@/pages/Workforce'));
const Employment=lazy(()=>import('@/pages/Employment').then(m=>({default:m.EmploymentSettings})));
const Onboarding=lazy(()=>import('@/components/settings/OnboardingSettings'));
const Training=lazy(()=>import('@/pages/OperationsSetup').then(m=>({default:m.TrainingRequirements})));
const Performance=lazy(()=>import('@/components/hr/PerformanceCycles'));
const Benefits=lazy(()=>import('@/pages/EmployeeServices').then(m=>({default:m.BenefitsSettings})));
const Expenses=lazy(()=>import('@/pages/EmployeeServices').then(m=>({default:m.ExpensesSettings})));
const Equipment=lazy(()=>import('@/pages/Equipment').then(m=>({default:m.EquipmentSettings})));
const Helpdesk=lazy(()=>import('@/components/settings/HelpdeskRules'));
const Communication=lazy(()=>import('@/pages/Communications').then(m=>({default:m.CommunicationSettings})));
const Documents=lazy(()=>import('@/components/documents/DocumentReviewPolicy').then(m=>({default:m.DocumentReviewPolicy})));
const Handbook=lazy(()=>import('@/pages/Handbook').then(m=>({default:m.HandbookSettings})));
const Letters=lazy(()=>import('@/pages/HrLetters').then(m=>({default:m.LetterTemplatesSettings})));
const Retention=lazy(()=>import('@/pages/Retention'));
const Reports=lazy(()=>import('@/components/reports/ReportPolicy'));
const Reminders=lazy(()=>import('@/pages/ReminderRules'));
const Accounts=lazy(()=>import('@/pages/UserManagement'));
const Readiness=lazy(()=>import('@/components/hr/SystemReadiness'));
const Setup=lazy(()=>import('@/pages/OperationsSetup'));

const groups=[
  {id:'company',label:'Company',icon:Building2},
  {id:'time-pay',label:'Time & pay',icon:Wallet},
  {id:'people',label:'People',icon:Users},
  {id:'services',label:'Employee services',icon:HeartHandshake},
  {id:'records',label:'Records',icon:FileText},
  {id:'system',label:'System',icon:Settings2},
] as const;
type Group=typeof groups[number]['id'];
type Setting={id:string;group:Group;title:string;description:string;keywords:string;icon:LucideIcon};
const settings:Setting[]=[
  {id:'company',group:'company',title:'Company & office calendar',description:'Contact details, working hours and weekly days off.',keywords:'address email phone head office friday saturday management schedule weekends',icon:Building2},
  {id:'branding',group:'company',title:'Branding & appearance',description:'App name, logos, favicon and search appearance.',keywords:'seo dark light theme upload title',icon:Palette},
  {id:'teams',group:'company',title:'Teams, sites & lead access',description:'Event and FEC teams, membership and arrival rules.',keywords:'mall venue activation supervisor acting manager location permissions grant qualifications skills',icon:Network},
  {id:'attendance',group:'time-pay',title:'Attendance rules',description:'Work calendars, breaks, grace periods and holidays.',keywords:'clock late shift working days employee override',icon:Clock3},
  {id:'leave',group:'time-pay',title:'Leave & approvers',description:'Entitlements, eligibility, half-days and approval stages.',keywords:'annual 30 days year carryover reporting manager supervisor acting balances accrual',icon:CalendarDays},
  {id:'payroll',group:'time-pay',title:'Salary & payroll rules',description:'Pay cycles, payday, allowances and employee overrides.',keywords:'28 27 1 monthly salary deduction overtime hourly temporary staff',icon:Wallet},
  {id:'wps',group:'time-pay',title:'WPS & bank export settings',description:'Employer registration, paying account and bank mappings.',keywords:'wages salary protection SIF Qatar bank IBAN QID payroll payslip export',icon:Wallet},
  {id:'calculations',group:'time-pay',title:'Calculation methods',description:'Attendance, leave, payroll and service calculations.',keywords:'rounding formula wage gratuity end service eos',icon:Calculator},
  {id:'devices',group:'time-pay',title:'Devices & attendance connections',description:'Biometric terminals, staff IDs, geofencing and device setup.',keywords:'external devices fingerprint faceid face recognition scan machine RFID card QR kiosk integration network IP GPS radius geofence supervisor coordinates location approval',icon:Fingerprint},
  {id:'employment',group:'people',title:'Employment & continuity',description:'Change approvals and qualifying service periods.',keywords:'promotion contract probation reporting manager service gap',icon:BriefcaseBusiness},
  {id:'onboarding',group:'people',title:'Onboarding approval rules',description:'Review requirements for joining and exit tasks.',keywords:'offboarding checklist independent reviewer deadline',icon:CheckCheck},
  {id:'checklists',group:'people',title:'Checklist templates',description:'Reusable onboarding and offboarding checklists.',keywords:'new hire tasks joining exit offboard documents',icon:ClipboardList},
  {id:'training',group:'people',title:'Mandatory training',description:'Required courses, eligible staff and due dates.',keywords:'30 days induction learning onboarding employee new staff',icon:GraduationCap},
  {id:'performance',group:'people',title:'Performance review cycles',description:'Review periods, rating criteria and participants.',keywords:'scores rubric self review objectives assessment',icon:ChartNoAxesCombined},
  {id:'benefits',group:'services',title:'Benefits & entitlements',description:'Eligibility, annual limits and individual exceptions.',keywords:'allowance benefit policy approval employee rules',icon:Gift},
  {id:'expenses',group:'services',title:'Expense policies',description:'Claim limits, eligibility and reimbursement rules.',keywords:'receipt approval allowances expense request',icon:Receipt},
  {id:'equipment',group:'services',title:'Equipment & custody rules',description:'Employee receipt, returns and inspection requirements.',keywords:'asset property acknowledgement lost damaged',icon:BriefcaseBusiness},
  {id:'helpdesk',group:'services',title:'Helpdesk settings',description:'Categories, routing, response targets and automation.',keywords:'sla support ticket escalation business hours calendar content query',icon:LifeBuoy},
  {id:'communications',group:'services',title:'Communication rules',description:'Team chat access, attachments and message limits.',keywords:'announcements direct messages dm group channel hub retention',icon:MessagesSquare},
  {id:'documents',group:'records',title:'Document review rules',description:'Replacement approvals and assigned reviewers.',keywords:'upload types approval expiry review days evidence',icon:FileCheck2},
  {id:'handbook',group:'records',title:'Handbook acknowledgements',description:'Acknowledgement statements and due periods.',keywords:'policy book required default employee read',icon:BookOpen},
  {id:'letters',group:'records',title:'HR letter templates',description:'Letter content, approval requirements and publishing.',keywords:'salary certificate employment bank signatory document',icon:FileText},
  {id:'retention',group:'records',title:'Record retention rules',description:'Retention periods and archive review deadlines.',keywords:'archive delete document expiry preservation',icon:Archive},
  {id:'reports',group:'records',title:'Reporting rules',description:'Report calculations, row limits and schedules.',keywords:'analytics turnover denominator performance sample export',icon:ChartNoAxesCombined},
  {id:'accounts',group:'system',title:'Accounts & role access',description:'Create accounts, assign roles and manage sign-in access.',keywords:'user password email username freeze revoke hold delete reset permission admin',icon:ShieldCheck},
  {id:'reminders',group:'system',title:'Reminders & notifications',description:'Deadline alerts, lead times and repeat frequency.',keywords:'training document expiry equipment handbook approval bell delivery',icon:Bell},
  {id:'setup',group:'system',title:'Setup overview',description:'Employee access and operational configuration gaps.',keywords:'readiness missing pending location supervisor induction setup',icon:ClipboardList},
  {id:'readiness',group:'system',title:'Services & recovery',description:'Email, file storage and recovery service status.',keywords:'system backup database smtp resend integration readiness',icon:SlidersHorizontal},
];

function SettingsPanel({id}:{id:string}):ReactNode{
  switch(id){
    case 'company':return <Company/>;
    case 'wps':return <Wps/>;
    case 'branding':return <Branding/>;
    case 'teams':return <Teams settingsOnly/>;
    case 'attendance':case 'leave':case 'payroll':return <Rules key={id} initialKind={id} embedded fixedKind/>;
    case 'calculations':return <Calculations/>;
    case 'devices':return <Devices/>;
    case 'employment':return <Employment/>;
    case 'onboarding':return <Onboarding/>;
    case 'checklists':return <Onboarding templatesOnly/>;
    case 'training':return <Training/>;
    case 'performance':return <Performance embedded/>;
    case 'benefits':return <Benefits/>;
    case 'expenses':return <Expenses/>;
    case 'equipment':return <Equipment/>;
    case 'helpdesk':return <Helpdesk/>;
    case 'communications':return <Communication/>;
    case 'documents':return <Documents/>;
    case 'handbook':return <Handbook/>;
    case 'letters':return <Letters/>;
    case 'retention':return <Retention settingsOnly/>;
    case 'reports':return <Reports/>;
    case 'accounts':return <Accounts embedded/>;
    case 'reminders':return <Reminders embedded/>;
    case 'setup':return <Setup settingsOnly/>;
    case 'readiness':return <Readiness/>;
    default:return null;
  }
}

export default function Settings(){
  const [,params]=useRoute('/settings/:section'),[,navigate]=useLocation();
  const [search,setSearch]=useState('');
  const [group,setGroup]=useState(()=>{
    const requested=new URLSearchParams(window.location.search).get('group');
    return groups.some(g=>g.id===requested)?requested!:'all';
  });
  const current=settings.find(s=>s.id===params?.section);
  const terms=search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible=settings.filter(s=>(group==='all'||s.group===group)&&terms.every(term=>`${s.title} ${s.description} ${s.keywords} ${groups.find(g=>g.id===s.group)?.label}`.toLowerCase().includes(term)));

  if(params&&!current)return <div className="rounded-2xl border bg-card p-8 space-y-4"><h1 className="text-xl font-semibold">Setting not found</h1><p>This settings section is unavailable.</p><Button asChild><Link href="/settings">Browse all settings</Link></Button></div>;
  if(current)return <div className="settings-center space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" asChild><Link href={`/settings?group=${current.group}`}><ArrowLeft className="mr-2 h-4 w-4"/>All settings</Link></Button>
      <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground"><span className="sr-only sm:not-sr-only">Jump to</span><select aria-label="Jump to a settings section" className="w-full max-w-[19rem] rounded-xl border bg-card px-3 py-2 text-foreground" value={current.id} onChange={e=>navigate(`/settings/${e.target.value}`)}>{groups.map(g=><optgroup label={g.label} key={g.id}>{settings.filter(s=>s.group===g.id).map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>)}</select></label></div>
    <header className="flex items-start gap-4 rounded-2xl border bg-card p-5 sm:p-6"><span className="rounded-2xl bg-primary/10 p-3 text-primary"><AnimatedIcon icon={current.icon}/></span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-widest text-primary">HR Rules & Settings · {groups.find(g=>g.id===current.group)?.label}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{current.title}</h1><p className="mt-2 text-sm text-muted-foreground">{current.description}</p></div></header>
    <Suspense fallback={<div role="status" className="rounded-2xl border bg-card p-8 text-muted-foreground">Loading settings…</div>}><SettingsPanel id={current.id}/></Suspense>
  </div>;

  return <div className="settings-center space-y-6">
    <ExperienceHero eyebrow="Your control center" title="HR Rules & Settings" description="One place to shape how your team works." icon={Settings2}>
      <div className="settings-hero-summary"><span className="text-sm opacity-80">Everything in one place</span><strong>{settings.length}<small>settings areas</small></strong><p>{groups.length} clear categories · Company and employee rules</p></div>
    </ExperienceHero>
    <section className="space-y-4" aria-label="Find settings">
      <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-0 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-muted-foreground"/><Input aria-label="Search HR rules and settings" type="search" className="h-12 rounded-2xl bg-card pl-12 pr-12" value={search} placeholder="Find a rule, policy or setting…" onChange={e=>{setSearch(e.target.value);setGroup('all');}}/>{search&&<Button size="icon" variant="ghost" aria-label="Clear settings search" className="absolute right-1 top-1" onClick={()=>setSearch('')}><X className="h-4 w-4"/></Button>}</div><span role="status" className="text-xs text-muted-foreground">{visible.length} {visible.length===1?'area':'areas'}</span></div>
      <div className="settings-categories" role="group" aria-label="Filter settings by category"><button aria-pressed={group==='all'} onClick={()=>setGroup('all')} className={cn('settings-category',group==='all'&&'is-active')}><Settings2 className="h-4 w-4"/>All settings</button>{groups.map(g=><button key={g.id} aria-pressed={group===g.id} onClick={()=>setGroup(g.id)} className={cn('settings-category',group===g.id&&'is-active')}><g.icon className="h-4 w-4"/>{g.label}</button>)}</div>
    </section>
    {!visible.length?<div className="rounded-2xl border bg-card p-10 text-center"><Search className="mx-auto mb-4 h-7 w-7 text-muted-foreground"/><h2 className="font-semibold">No matching settings</h2><p className="mt-2 text-sm text-muted-foreground">Try “leave”, “salary”, “training” or “access”.</p><Button variant="outline" className="mt-4" onClick={()=>{setSearch('');setGroup('all');}}>Show all settings</Button></div>:
      groups.map(g=>{const items=visible.filter(s=>s.group===g.id);return items.length>0&&<section key={g.id} aria-labelledby={`settings-${g.id}`} className="space-y-3"><div className="flex items-center gap-3"><h2 id={`settings-${g.id}`} className="text-base font-semibold">{g.label}</h2><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((s,index)=><Reveal key={s.id} delay={Math.min(index*.025,.1)}><Link href={`/settings/${s.id}`} className="settings-area group"><span className="settings-area-icon"><AnimatedIcon icon={s.icon}/></span><span className="min-w-0 flex-1"><span className="block font-semibold leading-snug">{s.title}</span><span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{s.description}</span></span><ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none"/></Link></Reveal>)}</div></section>;})}
  </div>;
}
