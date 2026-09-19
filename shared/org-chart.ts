import {z} from 'zod';
import {civilDate,positiveId,reason} from './hr-rules';
export const orgNode=z.object({employeeId:positiveId,parentEmployeeId:positiveId.nullable(),role:z.string().trim().min(1).max(100)}).strict();
export const orgChartInput=z.object({version:z.number().int().min(0),effectiveFrom:civilDate,effectiveTo:civilDate.nullable(),nodes:z.array(orgNode).max(500),reason}).strict().superRefine((v,ctx)=>{
 const error=(message:string)=>ctx.addIssue({code:'custom',message});
 if(v.effectiveTo&&v.effectiveTo<v.effectiveFrom)error('End date must follow the start date');
 const map=new Map(v.nodes.map(n=>[n.employeeId,n]));
 if(map.size!==v.nodes.length)error('Each employee can appear only once in a team chart');
 for(const node of v.nodes){
  const seen=new Set<number>();let current:typeof node|undefined=node;
  while(current){
   if(seen.has(current.employeeId)){error('Reporting lines cannot form a loop');break;}
   seen.add(current.employeeId);
   if(seen.size>20){error('Use no more than 20 reporting levels');break;}
   if(current.parentEmployeeId===null)break;
   if(!map.has(current.parentEmployeeId)){error('Every reporting manager must be included in this chart');break;}
   current=map.get(current.parentEmployeeId);
  }
 }
});
export type OrgNode=z.infer<typeof orgNode>;
export type OrgPerson={id:number;name:string;position:string;department:string;reportingManagerId:number|null};
export type ChartPerson=OrgNode&{name:string;department:string;position:string};
export type OrgChartView={version:number;revision:number|null;effectiveFrom:string|null;effectiveTo:string|null;nodes:ChartPerson[];canEdit:boolean;name:string;history:{version:number;effectiveFrom:string;effectiveTo:string|null;reason:string}[]};
