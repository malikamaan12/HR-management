import {z} from 'zod';
import type {TimeAssignment} from './timesheets';
export const reviewStatuses=['published','disputed','resolved','withdrawn'] as const;
export type AssignmentReviewStatus=typeof reviewStatuses[number];
export const reviewStatusLabels:Record<AssignmentReviewStatus,string>={published:'Published',disputed:'Disputed — HR review needed',resolved:'HR decision recorded',withdrawn:'Withdrawn'};
export const criterionKeys=['punctuality','service','teamwork','roleSkill'] as const;
export type Criterion=typeof criterionKeys[number];
export const reviewRubric={version:1,criteria:[
  {key:'punctuality' as const,label:'Punctuality',guidance:'Followed the agreed start, break and handover times. Explain approved changes or circumstances.'},
  {key:'service' as const,label:'Service',guidance:'Communicated clearly and provided respectful, accurate help to guests or internal customers.'},
  {key:'teamwork' as const,label:'Teamwork',guidance:'Cooperated with colleagues, shared information and completed agreed handovers.'},
  {key:'roleSkill' as const,label:'Role-specific skills',guidance:'Performed the role tasks described below using the agreed quality and safety procedures.'},
],anchors:['Needs substantial support','Needs improvement','Meets expectations','Exceeds expectations','Exceptional']};
const score=z.number().int().min(1).max(5).nullable(),example=z.string().trim().min(10).max(1500);
export const ratingFields={punctuality:score,service:score,teamwork:score,roleSkill:score,
  evidence:z.object({punctuality:example,service:example,teamwork:example,roleSkill:example}).strict(),
  roleExpectation:z.string().trim().min(10).max(1000),summary:z.string().trim().min(10).max(2000),improvementActions:z.string().trim().max(2000)};
export const ratingInput=z.object(ratingFields).strict().superRefine((v,ctx)=>{
  if(!criterionKeys.some(k=>v[k]!==null))ctx.addIssue({code:'custom',message:'Rate at least one observed criterion'});
  if(criterionKeys.some(k=>v[k]!==null&&v[k]!<=2)&&v.improvementActions.length<10)ctx.addIssue({code:'custom',message:'Describe improvement actions for scores of 1 or 2'});
});
export type RatingValues=z.infer<typeof ratingInput>;
export const responseInput=z.object({version:z.number().int().positive(),kind:z.enum(['acknowledge','comment','dispute']),message:z.string().trim().max(3000)}).strict().refine(v=>v.kind==='acknowledge'||v.message.length>=10,'Explain your response in at least 10 characters');
export const resolutionInput=z.discriminatedUnion('outcome',[
  z.object({version:z.number().int().positive(),outcome:z.literal('uphold'),reason:z.string().trim().min(10).max(3000)}).strict(),
  z.object({version:z.number().int().positive(),outcome:z.literal('withdraw'),reason:z.string().trim().min(10).max(3000)}).strict(),
  z.object({version:z.number().int().positive(),outcome:z.literal('amend'),reason:z.string().trim().min(10).max(3000),ratings:ratingInput}).strict(),
]);
export interface ReviewAssignment extends TimeAssignment {timesheetId:number;workedMinutes:number;timeStatus:string}
export interface AssignmentReviewRow extends ReviewAssignment,RatingValues {id:number;authorId:number;authorName:string;status:AssignmentReviewStatus;version:number;rubricVersion:number;rubric:typeof reviewRubric;responseKind:string|null;employeeResponse:string|null;respondedAt:string|null;resolution:string|null;resolutionReason:string|null;resolvedAt:string|null;createdAt:string;updatedAt:string}
export interface AssignmentReviewList {items:AssignmentReviewRow[];total:number;page:number;limit:number}
export interface AssignmentReviewDetail {review:AssignmentReviewRow;capabilities:{respond:boolean;dispute:boolean;resolve:boolean};history:{id:number;version:number;actorName:string;action:string;reason:string;createdAt:string;snapshot:RatingValues&{status:AssignmentReviewStatus;employeeResponse:string|null;resolutionReason:string|null}}[]}
export interface ReviewConfig {canReview:boolean;canResolve:boolean;rubric:typeof reviewRubric}
export interface TeamOverview {
  team:{id:number;name:string;siteName:string;timezone:string};from:string;to:string;staffingThrough:string;
  staffing:{shifts:number;required:number;accepted:number;unfilled:number;pendingOffers:number;gaps:{id:number;role:string;startAt:string;endAt:string;unfilled:number}[];absencesMore?:boolean;absences:{leaveId:number;employeeId:number;employeeName:string;leaveType:string;startDate:string;endDate:string;totalDays:number;dayPortion:string;absenceStartAt:string|null;absenceEndAt:string|null;shiftId:number;role:string;shiftStartAt:string;shiftEndAt:string}[]};
  time:null|{pending:number;items:{id:number;employeeName:string;role:string;startAt:string;workedMinutes:number}[]};
  reviews:null|{missing:number;disputed:number;withdrawn:number;included:number;awaitingResponse:number;unverified:number;missingItems:ReviewAssignment[];trend:{month:string;reviews:number;punctuality:number|null;punctualityCount:number;service:number|null;serviceCount:number;teamwork:number|null;teamworkCount:number}[]};
}
