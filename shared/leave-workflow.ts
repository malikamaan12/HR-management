import {localDate,siteTimeToIso} from './workforce';

export function leaveApprovalChain(snapshot:any):Array<number|null>{
  return Array.isArray(snapshot?.approvalChain)&&snapshot.approvalChain.length?snapshot.approvalChain:[snapshot?.approverId??null];
}
/** Office half-days use the midpoint of the saved work window, not a fixed noon cutoff. */
export function halfDayWindow(snapshot:any):{start:Date;end:Date}|null{
  if(!snapshot||snapshot.dayPortion==='full'||!snapshot.dayPortion)return null;
  const day=(snapshot.rules as any[])?.find(r=>r.counted),calendar=day?.calendar;
  if(!calendar||!day?.day)return null;
  const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3)),a=minutes(calendar.startTime),b=minutes(calendar.endTime);
  const midpoint=Math.floor((a+b)/2),clock=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  const start=snapshot.dayPortion==='first_half'?a:midpoint,end=snapshot.dayPortion==='first_half'?midpoint:b;
  return {start:new Date(siteTimeToIso(day.day+'T'+clock(start),calendar.timezone)),end:new Date(siteTimeToIso(day.day+'T'+clock(end),calendar.timezone))};
}
export function leaveOverlaps(snapshot:any,startDate:string,endDate:string,start:Date,end:Date,timezone:string){
  const partial=halfDayWindow(snapshot);
  if(partial)return +start<+partial.end&&+end>+partial.start;
  return localDate(start,timezone)<=endDate&&localDate(new Date(+end-1),timezone)>=startDate;
}
