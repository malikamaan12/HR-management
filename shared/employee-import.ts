export interface ImportColumn {key:string;label:string;required?:boolean;kind?:'date'|'integer'|'boolean';options?:string[];help?:string;}
export const employeeImportColumns:ImportColumn[]=[
 {key:'employeeId',label:'Employee ID',required:true,help:'Your unique employee reference; keep leading zeros.'},
 {key:'firstName',label:'First name',required:true},{key:'lastName',label:'Last name',required:true},
 {key:'gender',label:'Gender',required:true,options:['male','female','other']},
 {key:'dateOfBirth',label:'Date of birth',required:true,kind:'date'},
 {key:'nationality',label:'Nationality',required:true},{key:'qidNumber',label:'QID / identity reference',required:true},
 {key:'primaryMobile',label:'Primary mobile',required:true},{key:'residentialAddress',label:'Residential address',required:true},
 {key:'emergencyContactName',label:'Emergency contact name',required:true},{key:'emergencyContactNumber',label:'Emergency contact number',required:true},
 {key:'department',label:'Department',required:true},{key:'position',label:'Job title',required:true},{key:'location',label:'Location',required:true},
 {key:'joiningDate',label:'Joining date',required:true,kind:'date'},
 {key:'type',label:'Employment type',required:true,options:['permanent','temporary','contract']},
 {key:'personalEmail',label:'Personal email'},{key:'workEmail',label:'Work email'},{key:'fullNameArabic',label:'Arabic name'},
 {key:'contractEndDate',label:'Contract end date',kind:'date'},
 {key:'eventStaffEligible',label:'Eligible for event staffing',kind:'boolean',help:'true or false; blank defaults to false.'},
 {key:'workSchedule',label:'Work schedule',options:['unassigned','management_office','shift_based'],help:'Blank stays unassigned. Management office uses the configured Sunday–Thursday schedule.'},
 {key:'managerEmployeeId',label:'Reporting manager employee ID',help:'Existing active manager or another included, valid employee in this file.'},
 {key:'secondaryManagerEmployeeId',label:'Secondary manager employee ID',help:'Employee ID, not an account ID or database row number.'},
 {key:'workLocation',label:'Work location'},{key:'workPhone',label:'Work phone'},{key:'costCenter',label:'Cost center'},{key:'jobGrade',label:'Job grade'},
 {key:'probationPeriod',label:'Probation period (months)',kind:'integer'},{key:'noticePeriod',label:'Notice period (days)',kind:'integer'},
];
export type ImportIssue={field:string;message:string};
export type ImportPayload=Record<string,string>;
export type ImportRow={id:number;rowNumber:number;included:boolean;payload:ImportPayload;errors:ImportIssue[];employeeId:number|null};
export type ImportJob={id:number;fileName:string;status:string;version:number;totalRows:number;successfulRows:number;failedRows:number;includedRows:number;excludedRows:number;validRows:number;createdAt:string;completedAt:string|null;validatedAt:string|null;committedFromVersion:number|null;staged:boolean};
