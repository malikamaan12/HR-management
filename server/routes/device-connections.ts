import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {and,eq,ilike,inArray,like,or,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {appSettings,activityLogs,employees,workforceSites} from '@shared/schema';
import {deviceSave,type DeviceDefinition,type DeviceRevision,type DeviceProfile} from '@shared/device-connections';
import {authorize} from '../middleware/auth';
import {handle} from './hr-rules';
import {fail} from '../services/workforce';

const router=Router(),prefix='device_connection:',limit=200;
type StoredProfile={version:number;config:DeviceDefinition;updatedAt:string;updatedBy:number;history:DeviceRevision[]};
router.use(authorize(['admin','super_admin']));
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',handle(async(_req,res)=>{
  res.json(await db.transaction(async tx=>{
    const saved=await tx.select({key:appSettings.key,value:sql<Record<string,unknown>>`${appSettings.value}::jsonb - 'history'`}).from(appSettings).where(like(appSettings.key,'device\\_connection:%')).orderBy(appSettings.key);
    const records=saved.map(row=>({id:row.key.slice(prefix.length),...(row.value as StoredProfile)}));
    const employeeIds=[...new Set(records.flatMap(r=>r.config.mappings.map(m=>m.employeeId)))];
    const people=employeeIds.length?await tx.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,staffId:employees.employeeId,status:employees.status}).from(employees).where(inArray(employees.id,employeeIds)):[];
    const peopleById=new Map(people.map(p=>[p.id,{name:p.name,staffId:p.staffId,status:p.status}]));
    const devices:DeviceProfile[]=records.map(({history:_,...record})=>({...record,employeeNames:Object.fromEntries(record.config.mappings.flatMap(m=>peopleById.has(m.employeeId)?[[m.employeeId,peopleById.get(m.employeeId)!]]:[]))}));
    return {devices,sites:await tx.select({id:workforceSites.id,name:workforceSites.name,timezone:workforceSites.timezone}).from(workforceSites).orderBy(workforceSites.name),timezone:process.env.APP_TIMEZONE||'Asia/Qatar',limit,liveSyncAvailable:false};
  },{isolationLevel:'repeatable read'}));
}));
router.get('/employees',handle(async(req,res)=>{
  const q=z.string().max(100).parse(req.query.q||''),term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  res.json(await db.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,staffId:employees.employeeId,status:employees.status}).from(employees).where(and(eq(employees.status,'active'),or(sql`${employees.firstName} || ' ' || ${employees.lastName} ilike ${term}`,ilike(employees.employeeId,term)))).orderBy(employees.firstName,employees.id).limit(50));
}));
router.get('/:id/history',handle(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),[saved]=await db.select().from(appSettings).where(eq(appSettings.key,prefix+id));
  if(!saved)fail(404,'Device profile not found');
  res.json((saved.value as StoredProfile).history.slice().reverse());
}));
async function save(req:Parameters<Parameters<typeof handle>[0]>[0],id:string|null){
  const input=deviceSave.parse(req.body);
  return db.transaction(async tx=>{
    // Serializes the registry limit, serial uniqueness and version checks together.
    await tx.execute(sql`select pg_advisory_xact_lock(19283024)`);
    const rows=await tx.select({key:appSettings.key,value:sql<Record<string,unknown>>`${appSettings.value}::jsonb - 'history'`}).from(appSettings).where(like(appSettings.key,'device\\_connection:%'));
    const oldRow=id?(await tx.select().from(appSettings).where(eq(appSettings.key,prefix+id)))[0]:undefined,old=oldRow?.value as StoredProfile|undefined;
    if(id&&!old)fail(404,'Device profile not found');
    if((old?.version||0)!==input.version)fail(409,'This device profile changed. Close the editor and refresh before saving.');
    if(!id&&rows.length>=limit)fail(409,`The device registry allows ${limit} profiles. Update an existing profile.`);
    if(input.config.status!=='archived'&&input.config.serial&&rows.some(row=>row.key!==prefix+id&&(row.value as StoredProfile).config.status!=='archived'&&(row.value as StoredProfile).config.serial.toLowerCase()===input.config.serial.toLowerCase()))fail(409,'This serial or asset ID is already registered to another device.');
    if(input.config.siteId){const [site]=await tx.select({id:workforceSites.id}).from(workforceSites).where(eq(workforceSites.id,input.config.siteId));if(!site)fail(400,'Choose an existing work site.');}
    if(input.config.mappings.length){const people=await tx.select({id:employees.id,status:employees.status}).from(employees).where(inArray(employees.id,input.config.mappings.map(m=>m.employeeId)));if(people.length!==input.config.mappings.length)fail(400,'A mapped employee no longer exists. Remove that mapping before saving.');const oldIds=new Set(old?.config.mappings.map(m=>m.employeeId)||[]);if(people.some(p=>p.status!=='active'&&!oldIds.has(p.id)))fail(400,'New mappings require an active employee.');}
    const deviceId=id||randomUUID(),at=new Date().toISOString(),version=(old?.version||0)+1;
    const revision:DeviceRevision={version,config:input.config,reason:input.reason,at,actorId:req.user!.userId};
    const value:StoredProfile={version,config:input.config,updatedAt:at,updatedBy:req.user!.userId,history:[...(old?.history||[]),revision].slice(-30)};
    await tx.insert(appSettings).values({key:prefix+deviceId,value}).onConflictDoUpdate({target:appSettings.key,set:{value,updatedAt:new Date()}});
    await tx.insert(activityLogs).values({userId:req.user!.userId,action:id?'update':'create',entityType:'device_connection',details:JSON.stringify({deviceId,version,status:input.config.status,reason:input.reason})});
    return {id:deviceId,version};
  });
}
router.post('/',handle(async(req,res)=>res.status(201).json(await save(req,null))));
router.put('/:id',handle(async(req,res)=>res.json(await save(req,z.string().uuid().parse(req.params.id)))));
export default router;
