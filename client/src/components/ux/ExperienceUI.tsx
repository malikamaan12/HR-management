import {useId,type ReactNode} from 'react';
import {LazyMotion, domAnimation, MotionConfig, m, useReducedMotion} from 'framer-motion';
import {ArrowUpRight, Check, Sparkles, type LucideIcon} from 'lucide-react';
import {cn} from '@/lib/utils';

export function ExperienceMotion({children}:{children:ReactNode}) {
  return <LazyMotion features={domAnimation} strict><MotionConfig reducedMotion="user" transition={{type:'spring',stiffness:280,damping:26}}>{children}</MotionConfig></LazyMotion>;
}

export function Reveal({children,className,delay=0}:{children:ReactNode;className?:string;delay?:number}) {
  const reduced=useReducedMotion();
  return <m.div className={className} initial={reduced?false:{opacity:0,y:12}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:0.05}} transition={{duration:.36,delay,ease:[.22,1,.36,1]}}>{children}</m.div>;
}

export function AnimatedIcon({icon:Icon,className}:{icon:LucideIcon;className?:string}) {
  const reduced=useReducedMotion();
  return <m.span aria-hidden="true" className={cn('animated-icon',className)} whileHover={reduced?undefined:{rotate:-9,scale:1.12}} whileTap={reduced?undefined:{scale:.94}}><Icon/></m.span>;
}

export function ExperienceHero({eyebrow,title,description,actions,children,icon:Icon=Sparkles,variant='violet'}:{eyebrow:string;title:string;description?:string;actions?:ReactNode;children?:ReactNode;icon?:LucideIcon;variant?:'violet'|'mint'}) {
  const reduced=useReducedMotion();
  return <header className={cn('experience-hero',`hero-${variant}`)}>
    <div className="hero-grid" aria-hidden="true"/>
    <div className="hero-copy"><span className="hero-eyebrow"><span/>{eyebrow}</span><h1>{title}</h1>{description&&<p className="hero-description">{description}</p>}{actions&&<div className="hero-actions">{actions}</div>}</div>
    {children?<div className="hero-aside">{children}</div>:<div className="hero-art" aria-hidden="true"><m.div className="hero-orbit" initial={reduced?false:{rotate:-20,scale:.85}} animate={{rotate:0,scale:1}} transition={{duration:.8,ease:[.22,1,.36,1]}}/><m.div className="hero-object" initial={reduced?false:{y:18,rotate:-14}} animate={{y:0,rotate:-8}} transition={{duration:.7,ease:[.22,1,.36,1]}}><Icon/></m.div><span className="hero-satellite satellite-check"><Check/></span><span className="hero-satellite satellite-arrow"><ArrowUpRight/></span></div>}
  </header>;
}

export function ProgressRing({value,total,label}:{value:number;total:number;label:string}) {
  const reduced=useReducedMotion(),percent=total>0?Math.max(0,Math.min(100,Math.round(value/total*100))):0;
  return <div className="progress-orbit" role="img" aria-label={`${label}: ${value} of ${total}, ${percent}%`}><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" className="orbit-track"/><m.circle cx="60" cy="60" r="50" className="orbit-progress" strokeDasharray={314.16} initial={reduced?false:{strokeDashoffset:314.16}} animate={{strokeDashoffset:314.16*(1-percent/100)}} transition={{duration:reduced?0:.8,ease:'easeOut'}}/></svg><span><strong>{total?`${percent}%`:'—'}</strong><small>{label}</small></span></div>;
}

export function MiniTrend({values,label}:{values:number[];label:string}) {
  const reduced=useReducedMotion(),id=useId().replaceAll(':',''),max=Math.max(1,...values);
  if(!values.length)return null;
  const points=values.map((value,i)=>`${i/(Math.max(values.length-1,1))*240},${64-Math.max(0,value)/max*54}`);
  const line=`M${points.join(' L')}`;
  return <div className="hero-trend" role="img" aria-label={label}><span>{label}</span><svg viewBox="0 0 240 76" aria-hidden="true"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d1f2af" stopOpacity=".23"/><stop offset="100%" stopColor="#d1f2af" stopOpacity="0"/></linearGradient></defs><path d={`${line} L240,76 L0,76 Z`} fill={`url(#${id})`}/><m.path d={line} fill="none" stroke="#d1f2af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={reduced?false:{pathLength:0}} animate={{pathLength:1}} transition={{duration:reduced?0:1,ease:'easeOut'}}/></svg><small>Daily records · selected period</small></div>;
}
