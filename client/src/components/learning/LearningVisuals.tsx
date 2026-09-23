import { useState } from 'react';
import { Check, ImageIcon } from 'lucide-react';
import type { CourseDefinition } from '@shared/employee-services';
import { Field, fieldClass } from '@/components/hr/Operations';

type Cover = Pick<CourseDefinition, 'title' | 'coverImage' | 'coverImageUrl'>;
export const courseCovers = [{id:'welcome',label:'Welcome & induction'},{id:'safety',label:'Safety & operations'},{id:'service',label:'Guest experience'},{id:'leadership',label:'Team development'},{id:'fire',label:'Fire awareness'},{id:'first-aid',label:'First aid awareness'}] as const;
export function coverKey(course: Cover) {
  if(course.coverImage && course.coverImage !== 'auto') return course.coverImage;
  const title = course.title.toLowerCase();
  if(/first aid/.test(title)) return 'first-aid';
  if(/fire|evacuat/.test(title)) return 'fire';
  if(/safe|heat|hse|emergency|risk|incident|security|hygiene|equipment/.test(title)) return 'safety';
  if(/guest|service|communication|customer|hospitality/.test(title)) return 'service';
  if(/lead|manage|supervis|coach|teamwork|development/.test(title)) return 'leadership';
  return 'welcome';
}
export const durationLabel = (minutes:number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes/60)}h${minutes%60 ? ` ${minutes%60}m` : ''}`;
export function CourseCover({course,className='',eager=false}:{course:Cover;className?:string;eager?:boolean}) {
  const [failed,setFailed]=useState('');
  const custom=course.coverImageUrl || '', fallback=`/images/learning/${coverKey(course)}.webp`;
  return <img className={`course-cover ${className}`} src={custom && failed !== custom ? custom : fallback} alt="" loading={eager?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>{if(custom && failed!==custom)setFailed(custom);}}/>;
}
export function LearningProgress({value,label}:{value:number;label:string}) {
  return <div className="learning-progress"><div><span>{label}</span><strong>{value}%</strong></div><progress max={100} value={value} aria-label={label}/></div>;
}
export function CourseCoverPicker({course,onChange}:{course:Cover;onChange:(patch:Partial<CourseDefinition>)=>void}) {
  return <fieldset className="space-y-3 min-w-0"><legend className="mb-3 flex items-center gap-2 text-sm font-medium"><ImageIcon className="h-4 w-4"/>Course cover</legend>
    <div className="course-cover-choices">{courseCovers.map(cover=><button key={cover.id} type="button" aria-pressed={course.coverImage===cover.id&&!course.coverImageUrl} onClick={()=>onChange({coverImage:cover.id,coverImageUrl:''})}><img src={`/images/learning/${cover.id}.webp`} alt="" loading="lazy"/><span>{cover.label}{course.coverImage===cover.id&&!course.coverImageUrl&&<Check className="h-3 w-3"/>}</span></button>)}</div>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!course.coverImage||course.coverImage==='auto'} onChange={e=>onChange({coverImage:e.target.checked?'auto':'welcome'})}/>Choose artwork from the course title</label>
    <Field label="Custom cover image URL (optional)"><input className={fieldClass} type="url" placeholder="https://…" maxLength={2000} value={course.coverImageUrl||''} onChange={e=>onChange({coverImageUrl:e.target.value})}/></Field>
    {course.coverImageUrl&&<div className="max-w-xs overflow-hidden rounded-xl"><CourseCover course={course}/></div>}
  </fieldset>;
}

export const inductionStatus=(value:string)=>value==='completion_submitted'?'Awaiting completion review':value.replaceAll('_',' ').replace(/^./,v=>v.toUpperCase());
