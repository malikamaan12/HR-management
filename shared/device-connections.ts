import {z} from 'zod';
import {positiveId,reason} from './hr-rules';

export const deviceKinds=['fingerprint','face','multi_biometric','card_reader','qr_scanner','kiosk','access_terminal','other'] as const;
export const deviceKindLabels:Record<typeof deviceKinds[number],string>={fingerprint:'Fingerprint terminal',face:'Face-recognition terminal',multi_biometric:'Multi-biometric terminal',card_reader:'RFID / card reader',qr_scanner:'QR / barcode scanner',kiosk:'Attendance kiosk',access_terminal:'Access-control terminal',other:'Other device'};
export const connectionMethods=['local_bridge','local_api','vendor_cloud','file_export'] as const;
export const connectionMethodLabels:Record<typeof connectionMethods[number],string>={local_bridge:'Local network bridge',local_api:'On-site API via bridge',vendor_cloud:'Vendor cloud API',file_export:'Device file export'};
export const profileStatuses=['setup','paused','archived'] as const;
export const profileStatusLabels={setup:'In setup',paused:'Setup paused',archived:'Archived'};
const line=(max:number)=>z.string().trim().max(max).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'Use a single line of text');
export const deviceMappingSchema=z.object({deviceUserId:line(80).refine(v=>v.length>0,'Enter the device user ID'),employeeId:positiveId}).strict();
export const deviceDefinition=z.object({
  presetId:z.enum(['custom','zkteco_push','hikvision_isapi','suprema_biostar','anviz_crosschex','generic_fingerprint','generic_face','generic_card','generic_qr','generic_kiosk','generic_file']).default('custom'),protocol:line(120).default(''),
  name:line(120).refine(v=>v.length>=2,'Enter a device name with at least two characters'),kind:z.enum(deviceKinds),brand:line(100),model:line(100),serial:line(120),
  status:z.enum(profileStatuses),siteId:positiveId.nullable(),timezone:line(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return !!value;}catch{return false;}},'Choose a valid IANA timezone, such as Asia/Qatar'),
  method:z.enum(connectionMethods),host:line(253).refine(v=>!v||/^[a-zA-Z0-9.:[\]-]+$/.test(v),'Enter a hostname or IP address only, without a URL, path or credentials'),port:z.number().int().min(1).max(65535).nullable(),cloudUrl:line(500).refine(v=>{if(!v)return true;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}},'Use an HTTPS base URL without credentials, query parameters or a fragment'),
  credentialReference:line(160),notes:z.string().trim().max(1500),mappings:z.array(deviceMappingSchema).max(500),
}).strict().superRefine((value,ctx)=>{
  const ids=value.mappings.map(m=>m.deviceUserId.toLowerCase());
  if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',path:['mappings'],message:'Use each device user ID once per device'});
  if(new Set(value.mappings.map(m=>m.employeeId)).size!==value.mappings.length)ctx.addIssue({code:'custom',path:['mappings'],message:'Map an employee only once per device'});
  if(value.method!=='local_bridge'&&(value.host||value.port!==null))ctx.addIssue({code:'custom',message:'Network host and port apply only to a local bridge'});
  if(!['vendor_cloud','local_api'].includes(value.method)&&value.cloudUrl)ctx.addIssue({code:'custom',message:'API URL applies only to an API connection'});
});
export const deviceSave=z.object({version:z.number().int().min(0),config:deviceDefinition,reason}).strict();
export type DeviceDefinition=z.infer<typeof deviceDefinition>;
export type DeviceRevision={version:number;config:DeviceDefinition;reason:string;at:string;actorId:number};
export type DeviceProfile={id:string;version:number;config:DeviceDefinition;updatedAt:string;updatedBy:number;employeeNames:Record<number,{name:string;staffId:string;status:string}>};
export type DeviceContext={devices:DeviceProfile[];sites:{id:number;name:string;timezone:string}[];timezone:string;limit:number;liveSyncAvailable:false};
export function emptyDevice(timezone:string):DeviceDefinition{return {presetId:'custom',protocol:'',name:'',kind:'fingerprint',brand:'',model:'',serial:'',status:'setup',siteId:null,timezone,method:'local_bridge',host:'',port:null,cloudUrl:'',credentialReference:'',notes:'',mappings:[]};}
export type DevicePreset={id:Exclude<DeviceDefinition['presetId'],'custom'>;name:string;brand:string;kind:DeviceDefinition['kind'];method:DeviceDefinition['method'];protocol:string;description:string;requirements:string;documentation?:string};
export const devicePresets:DevicePreset[]=[
  {id:'zkteco_push',name:'ZKTeco · PUSH SDK',brand:'ZKTeco',kind:'multi_biometric',method:'local_bridge',protocol:'ZKTeco Attendance PUSH SDK',description:'Setup for a PUSH-compatible attendance terminal.',requirements:'Confirm Attendance PUSH support on the selected model and firmware. A compatible receiver or local bridge must be implemented.',documentation:'https://www.zkteco.com/en/PUSHSDK'},
  {id:'hikvision_isapi',name:'Hikvision · ISAPI',brand:'Hikvision',kind:'face',method:'local_api',protocol:'Hikvision ISAPI',description:'Setup for an ISAPI-capable face or access terminal.',requirements:'Use the manufacturer’s model-specific ISAPI capability documentation. An on-site connector and event mapping are required.',documentation:'https://tpp.hikvision.com/download/'},
  {id:'suprema_biostar',name:'Suprema · BioStar 2',brand:'Suprema',kind:'multi_biometric',method:'local_api',protocol:'BioStar 2 local REST API',description:'Setup through a BioStar 2 server.',requirements:'Record the BioStar server address. Confirm the installed API version, licensing and attendance event access with the installer.',documentation:'https://support.supremainc.com/en/support/solutions/articles/24000047041'},
  {id:'anviz_crosschex',name:'Anviz · CrossChex Cloud',brand:'Anviz',kind:'multi_biometric',method:'vendor_cloud',protocol:'CrossChex Cloud API',description:'Setup through a CrossChex Cloud account.',requirements:'Confirm supported devices, regional API URL and account API access. API credentials belong in the future connector’s secret store.',documentation:'https://community.anviz.com/t/how-to-use-api-to-get-the-records-from-the-crosschex-cloud/726'},
  {id:'generic_fingerprint',name:'Generic fingerprint',brand:'',kind:'fingerprint',method:'local_bridge',protocol:'',description:'A manufacturer-neutral fingerprint terminal profile.',requirements:'Add the manufacturer, exact model, supported protocol and attendance event format.'},
  {id:'generic_face',name:'Generic face scanner',brand:'',kind:'face',method:'local_bridge',protocol:'',description:'A manufacturer-neutral face-recognition profile.',requirements:'Confirm event export/API support. Face enrolment and templates remain on the selected hardware.'},
  {id:'generic_card',name:'Generic RFID / card reader',brand:'',kind:'card_reader',method:'local_bridge',protocol:'',description:'Badge reader or controller-based attendance.',requirements:'Identify the controller or software that converts card reads into timestamped attendance events.'},
  {id:'generic_qr',name:'Generic QR / barcode',brand:'',kind:'qr_scanner',method:'local_bridge',protocol:'',description:'QR reader or scanner connected through a kiosk.',requirements:'A scanner alone does not submit attendance. Identify its host application and output format.'},
  {id:'generic_kiosk',name:'Generic tablet / kiosk',brand:'',kind:'kiosk',method:'local_api',protocol:'',description:'A shared attendance kiosk connection profile.',requirements:'Confirm the kiosk application, supported API and staff identification method.'},
  {id:'generic_file',name:'Generic attendance file',brand:'',kind:'other',method:'file_export',protocol:'CSV / vendor export format',description:'A profile for hardware with attendance-file exports.',requirements:'Provide a sample file and its staff ID, timestamp, timezone and punch-direction columns before an importer is implemented.'},
];
export function applyDevicePreset(config:DeviceDefinition,preset:DevicePreset):DeviceDefinition{return {...config,presetId:preset.id,brand:preset.brand,kind:preset.kind,method:preset.method,protocol:preset.protocol,host:'',port:null,cloudUrl:'',model:''};}
// Readiness describes saved setup details, never a verified network connection.
export function deviceSetupIssues(config:DeviceDefinition){const issues:string[]=[];
  if(!config.brand)issues.push('Add the manufacturer');
  if(!config.model)issues.push('Add the model');
  if(!config.serial)issues.push('Add the serial or asset ID');
  if(!config.siteId)issues.push('Assign a work site');
  if(!config.protocol)issues.push('Confirm the connection protocol');
  if(config.method==='local_bridge'&&!config.host)issues.push('Add the network host');
  if(config.method==='local_bridge'&&!config.port)issues.push('Add the device port');
  if(['vendor_cloud','local_api'].includes(config.method)&&!config.cloudUrl)issues.push('Add the API base URL');
  if(!config.mappings.length)issues.push('Map staff IDs');
  return issues;
}
