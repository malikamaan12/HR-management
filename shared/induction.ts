import {z} from 'zod';
import {positiveId,reason,civilDate} from './hr-rules';
import {courseDefinition} from './employee-services';

const uid=z.string().uuid();
export const inductionLesson=z.object({id:uid,title:z.string().trim().min(1).max(180),kind:z.enum(['text','document','video']),body:z.string().trim().max(40000),assetId:positiveId.nullable(),required:z.boolean(),estimatedMinutes:z.number().int().min(0).max(600)}).strict().superRefine((v,c)=>{
 if(v.kind==='text'&&!v.body)c.addIssue({code:'custom',path:['body'],message:'Add lesson content'});
 if(v.kind!=='text'&&!v.assetId)c.addIssue({code:'custom',path:['assetId'],message:'Upload and choose a private course asset'});
});
export const inductionQuestion=z.object({id:uid,prompt:z.string().trim().min(3).max(3000),kind:z.enum(['single','multiple','true_false']),options:z.array(z.object({id:uid,text:z.string().trim().min(1).max(1000)}).strict()).min(2).max(8),correctOptionIds:z.array(uid).min(1).max(8),points:z.number().int().min(1).max(20),explanation:z.string().trim().max(3000)}).strict().superRefine((q,c)=>{
 const ids=q.options.map(o=>o.id);
 if(new Set(ids).size!==ids.length||new Set(q.correctOptionIds).size!==q.correctOptionIds.length||q.correctOptionIds.some(id=>!ids.includes(id)))c.addIssue({code:'custom',path:['options'],message:'Use unique options and select valid correct answers'});
 if(q.kind!=='multiple'&&q.correctOptionIds.length!==1)c.addIssue({code:'custom',path:['correctOptionIds'],message:'Select exactly one correct answer'});
 if(q.kind==='true_false'&&q.options.length!==2)c.addIssue({code:'custom',path:['options'],message:'True/false questions must have two options'});
});
export const inductionSettings=z.object({
 passScore:z.number().int().min(0).max(100),maxAttempts:z.number().int().min(1).max(20),retryDelayMinutes:z.number().int().min(0).max(10080),attemptMinutes:z.number().int().min(1).max(180),
 shuffleQuestions:z.boolean(),shuffleOptions:z.boolean(),questionCount:z.number().int().min(0).max(100),sequentialLessons:z.boolean(),
 reviewRequired:z.boolean(),enrollmentApprovalRequired:z.boolean(),allowSelfEnrollment:z.boolean(),mandatoryForOnboarding:z.boolean(),defaultDueDays:z.number().int().min(0).max(365),dueDateBasis:z.enum(['enrollment','joining_date']).default('enrollment'),
 validMonths:z.number().int().min(1).max(120).nullable(),employeeTypes:z.array(z.enum(['permanent','temporary','contract'])).min(1).max(3),departments:z.array(z.string().trim().min(1).max(150)).max(100),
}).strict();
export const defaultInductionSettings:z.infer<typeof inductionSettings>={passScore:80,maxAttempts:3,retryDelayMinutes:0,attemptMinutes:30,shuffleQuestions:true,shuffleOptions:true,questionCount:0,sequentialLessons:true,reviewRequired:false,enrollmentApprovalRequired:false,allowSelfEnrollment:true,mandatoryForOnboarding:false,defaultDueDays:7,dueDateBasis:'enrollment',validMonths:null,employeeTypes:['permanent','temporary','contract'],departments:[]};
export const inductionContent=z.object({lessons:z.array(inductionLesson).min(1).max(60),questions:z.array(inductionQuestion).min(1).max(100),settings:inductionSettings}).strict().superRefine((v,c)=>{
 if(JSON.stringify(v).length>400000)c.addIssue({code:'custom',path:[],message:'Course text is too large. Keep a release under 400,000 characters and split longer training into separate courses.'});
 if(new Set(v.lessons.map(x=>x.id)).size!==v.lessons.length||new Set(v.questions.map(x=>x.id)).size!==v.questions.length)c.addIssue({code:'custom',path:[],message:'Lesson and question identifiers must be unique'});
 if(v.settings.questionCount>v.questions.length)c.addIssue({code:'custom',path:['settings','questionCount'],message:'Quiz size cannot exceed the question bank'});
 if(!v.lessons.some(l=>l.required))c.addIssue({code:'custom',path:['lessons'],message:'Include at least one required lesson'});
});
export type InductionContent=z.infer<typeof inductionContent>;
export type InductionSettings=z.infer<typeof inductionSettings>;
export type InductionLesson=z.infer<typeof inductionLesson>;
export type InductionQuestion=z.infer<typeof inductionQuestion>;
export type PublicInductionQuestion=Omit<InductionQuestion,'correctOptionIds'|'explanation'>;
export type PublicInductionContent=Omit<InductionContent,'questions'>&{questionCount:number};
export const inductionCreate=z.object({definition:courseDefinition,content:inductionContent,reason}).strict();
export const inductionRevision=inductionCreate.extend({version:positiveId,draftVersion:positiveId});
export const inductionPublish=z.object({version:positiveId,draftVersion:positiveId,reason}).strict();
export const inductionBrand=z.object({organizationName:z.string().trim().min(1).max(160),academyTitle:z.string().trim().min(1).max(160),welcomeText:z.string().trim().max(1000),accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),certificateTitle:z.string().trim().min(1).max(160),certificatePrefix:z.string().regex(/^[A-Z0-9-]{2,20}$/),signatoryTitle:z.string().trim().max(160),logoAssetId:positiveId.nullable(),maxUploadMb:z.number().int().min(1).max(40).default(20),mediaBudgetMb:z.number().int().min(0).max(512).default(100)}).strict();
export type InductionBrand=z.infer<typeof inductionBrand>;
export const inductionAssignment=z.object({employeeIds:z.array(positiveId).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'Choose each employee once'),releaseId:positiveId,dueDate:civilDate.nullable(),required:z.boolean(),reason}).strict();
export const inductionAttemptStart=z.object({version:positiveId,key:z.string().uuid()}).strict();
export const inductionAttemptSubmit=z.object({answers:z.array(z.object({questionId:uid,optionIds:z.array(uid).min(1).max(8)}).strict()).min(1).max(100)}).strict();
export function publicInductionContent(content:InductionContent):PublicInductionContent{return {lessons:content.lessons,settings:content.settings,questionCount:content.settings.questionCount||content.questions.length};}
