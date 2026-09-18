import {expect,test,vi} from 'vitest';
import {defaultInductionSettings} from '../shared/induction';
import {leaveRule} from '../shared/hr-rules';
import type {OperationsSetupSectionId} from '../shared/operations-setup';
vi.mock('../server/db',()=>({db:{},pool:{}}));
import {evaluateOperationsSetup,type OperationsSetupData} from '../server/services/operations-setup';

const day='2026-09-19';
const policy=()=>leaveRule.parse({paid:true,balanceRequired:false,accrualMode:'none',annualDays:0,monthlyDays:0,carryoverLimit:0,minServiceDays:0,maxConsecutiveDays:30,approverId:20});
function fixture():OperationsSetupData{
  return {
    counts:{activeEmployees:1,linkedEmployees:1,teams:1,sites:1},
    people:[{id:1,code:'SYNTHETIC-1',userId:10,type:'permanent',department:'Operations',workSchedule:'shift_based',reportingManagerId:2}],
    accounts:[
      {id:10,role:'permanent_employee',department:'Operations',isActive:true,approvalStatus:'approved',employeeId:1,employeeStatus:'active'},
      {id:20,role:'hr',department:'Operations',isActive:true,approvalStatus:'approved',employeeId:2,employeeStatus:'active'},
    ],
    teams:[{id:1,siteId:1,name:'Synthetic team'}],
    memberships:[{id:1,teamId:1,employeeId:1,startAt:day+'T06:00:00Z',endAt:day+'T14:00:00Z'}],
    grants:[{teamId:1,userId:20,startAt:day+'T06:00:00Z',endAt:day+'T14:00:00Z'}],
    shifts:[{id:1,teamId:1,employeeId:1,startAt:day+'T06:00:00Z',endAt:day+'T14:00:00Z'}],
    locations:[null,1].map((siteId,index)=>({id:index+1,config:{name:'Synthetic boundary',latitude:25.3,longitude:51.5,radiusMeters:100,enabled:true,siteId,employeeIds:[],startsOn:null,endsOn:null}})),
    gpsRequired:true,requirePermanentApproval:false,
    leaveTypes:['Annual'],rules:[{id:1,employeeId:null,name:'Annual',config:policy()}],
    courses:[{id:1,title:'Synthetic induction',approverId:20,settings:{...defaultInductionSettings,mandatoryForOnboarding:true}}],
    onboarding:[],enrollments:[],truncated:false,
    window:{start:'2026-09-18T21:00:00Z',end:'2026-09-19T21:00:00Z'},
  };
}
const section=(data:OperationsSetupData,id:OperationsSetupSectionId)=>evaluateOperationsSetup(data,day).sections.find(s=>s.id===id)!;

test('a fully configured synthetic employee has ready sections but an empty company never does',()=>{
  const configured=fixture();
  expect(evaluateOperationsSetup(configured,day).sections.every(s=>s.status==='ready')).toBe(true);
  const empty={...fixture(),counts:{activeEmployees:0,linkedEmployees:0,teams:0,sites:0},people:[],accounts:[],teams:[],memberships:[],grants:[],shifts:[],locations:[],rules:[],leaveTypes:[],courses:[],onboarding:[],enrollments:[]};
  expect(evaluateOperationsSetup(empty,day).sections.map(s=>s.status)).toEqual(Array(5).fill('not_started'));
});

test('a reviewer must cover the full accepted overnight shift beyond the preview date',()=>{
  const data=fixture();
  data.memberships[0].endAt='2026-09-20T01:00:00Z';
  data.shifts[0]={...data.shifts[0],startAt:day+'T18:00:00Z',endAt:'2026-09-20T01:00:00Z'};
  data.grants[0].endAt=data.window.end;
  const incomplete=section(data,'supervisors');
  expect(incomplete.issues.some(i=>i.key==='grant-1')).toBe(false);
  expect(incomplete.issues.some(i=>i.key==='shift-1-1')).toBe(true);
  data.grants[0].endAt='2026-09-20T01:00:00Z';
  expect(section(data,'supervisors').status).toBe('ready');
});

test('separate partial grants cannot jointly authorize review of one complete accepted shift',()=>{
  const data=fixture();
  data.accounts.push({...data.accounts[1],id:30,employeeId:3});
  data.grants=[{...data.grants[0],endAt:day+'T10:00:00Z'},{...data.grants[0],userId:30,startAt:day+'T10:00:00Z'}];
  const result=section(data,'supervisors');
  expect(result.issues.some(i=>i.key==='grant-1')).toBe(false);
  expect(result.issues.some(i=>i.key==='shift-1-1')).toBe(true);
});

test('self, inactive and unapproved accounts cannot satisfy independent team review coverage',()=>{
  for(const invalid of ['self','inactive','pending'] as const){
    const data=fixture();
    if(invalid==='self')data.grants[0].userId=10;
    if(invalid==='inactive')data.accounts[1].isActive=false;
    if(invalid==='pending')data.accounts[1].approvalStatus='pending';
    const result=section(data,'supervisors');
    expect(result.status,invalid).toBe('action_required');
    expect(result.issues.some(i=>i.key==='shift-1-1'),invalid).toBe(true);
  }
});

test('a null first leave stage needs a candidate independent from the employee and all later stages',()=>{
  const data=fixture();
  data.accounts[0].role='super_admin';
  data.rules[0].config={...policy(),approverId:null,additionalApproverIds:[20]};
  let result=section(data,'leave');
  expect(result.issues.some(i=>i.key==='approver-1-Annual-0')).toBe(true);
  expect(result.issues.some(i=>i.key==='approver-1-Annual-1')).toBe(false);
  data.accounts.push({...data.accounts[1],id:30,employeeId:3});
  result=section(data,'leave');
  expect(result.status).toBe('ready');
});

test('open leave approval respects actual department scope and keeps a fifth independent candidate',()=>{
  const data=fixture();
  data.rules[0].config={...policy(),approverId:null};
  data.accounts[1]={...data.accounts[1],role:'hr_manager',department:'Finance'};
  expect(section(data,'leave').status).toBe('action_required');
  data.accounts[1].department='Operations';
  expect(section(data,'leave').status).toBe('ready');

  data.accounts[0].role='super_admin';
  data.accounts[1].role='hr';
  data.accounts.push(...[30,40,50].map(id=>({...data.accounts[1],id,employeeId:id})));
  data.rules[0].config={...policy(),approverId:null,additionalApproverIds:[20,30,40]};
  expect(section(data,'leave').status).toBe('ready');
  data.accounts=data.accounts.filter(account=>account.id!==50);
  expect(section(data,'leave').status).toBe('action_required');
});

test('data truncation prevents ready status and visible issue limits retain the full count',()=>{
  const data=fixture();data.truncated=true;
  const truncated=evaluateOperationsSetup(data,day);
  expect(truncated.truncated).toBe(true);
  expect(truncated.sections.every(s=>s.status==='action_required'&&s.issues.some(i=>i.key==='data-limit'))).toBe(true);
  const many=fixture();
  many.people=Array.from({length:60},(_,index)=>({...many.people[0],id:index+1,code:`SYNTHETIC-${index+1}`,userId:null,workSchedule:'management_office'}));
  many.counts={...many.counts,activeEmployees:60,linkedEmployees:0};
  const result=section(many,'people');
  expect(result.issues).toHaveLength(50);
  expect(result.issueCount).toBe(60);
});
