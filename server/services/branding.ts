import {eq} from 'drizzle-orm';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {db} from '../db';
import {appSettings} from '@shared/schema';
import {assetKeys,brandingSchema,defaultBranding,maxBrandingBytes,type Branding,type BrandingAsset,type PublicBranding} from '@shared/branding';

export type StoredBranding={settings:Branding;version:number;assets:Partial<Record<BrandingAsset,string>>};
export const emptyBranding=():StoredBranding=>({settings:{...defaultBranding},version:0,assets:{}});
export async function getBranding(executor:Pick<typeof db,'select'>=db):Promise<StoredBranding>{
  const [row]=await executor.select().from(appSettings).where(eq(appSettings.key,'branding'));
  return row ? {...row.value as StoredBranding,settings:brandingSchema.parse((row.value as StoredBranding).settings)} : emptyBranding();
}
export function publicBranding(value:StoredBranding):PublicBranding {
  return {...value.settings,version:value.version,assets:Object.fromEntries(assetKeys.filter(key=>value.assets[key]).map(key=>[key,`/api/branding/assets/${key}?v=${createHash('sha256').update(value.assets[key]!).digest('hex').slice(0,16)}`]))};
}

function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
/** Validate bounded PNG data and discard ancillary metadata. No uploaded SVG/HTML is served. */
export function validateBrandingPng(buffer:Buffer,kind:BrandingAsset):Buffer {
  const invalid=()=>new Error('Upload a valid PNG image (up to 512 KB and 2048 × 2048 pixels). Favicons must be square, 16–512 pixels.');
  if(buffer.length>maxBrandingBytes||buffer.length<45||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw invalid();
  let offset=8,width=0,height=0,depth=0,color=0,interlace=0,ended=false,hasData=false,hasPalette=false;
  const kept=[buffer.subarray(0,8)],compressed:Buffer[]=[];
  while(offset+12<=buffer.length){
    const length=buffer.readUInt32BE(offset),end=offset+12+length;
    if(end>buffer.length)throw invalid();
    const type=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,end-4);
    if(crc32(buffer.subarray(offset+4,end-4))!==buffer.readUInt32BE(end-4))throw invalid();
    if(offset===8&&type!=='IHDR')throw invalid();
    if(type==='IHDR'){
      if(offset!==8||length!==13)throw invalid();
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];color=data[9];interlace=data[12];
      const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!width||!height||width>2048||height>2048||!depths[color]?.includes(depth)||data[10]||data[11]||interlace>1)throw invalid();
      if(kind==='favicon'&&(width!==height||width<16||width>512))throw invalid();
    }else if(type==='IDAT'){hasData=true;compressed.push(data);}
    else if(type==='PLTE'){if(hasData||hasPalette||length===0||length%3||length>768)throw invalid();hasPalette=true;}
    else if(type==='IEND'){if(length||end!==buffer.length)throw invalid();ended=true;}
    else if(type!=='tRNS'&&type[0]===type[0].toUpperCase())throw invalid();
    if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type))kept.push(buffer.subarray(offset,end));
    offset=end;
  }
  if(!ended||!hasData||(color===3&&!hasPalette))throw invalid();
  // Bound decompression and verify scanline lengths/filter bytes, including Adam7 images.
  const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.flatMap(([x,y,dx,dy])=>{const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));return w&&h?Array(h).fill(Math.ceil(w*channels[color]*depth/8)+1):[];});
  let inflated:Buffer;try{inflated=inflateSync(Buffer.concat(compressed),{maxOutputLength:rows.reduce((a,b)=>a+b,0)});}catch{throw invalid();}
  let position=0;for(const size of rows){if(inflated[position]>4)throw invalid();position+=size;}
  if(position!==inflated.length)throw invalid();
  return Buffer.concat(kept);
}

export function brandingHtml(template:string,value:StoredBranding){
  const brand=publicBranding(value),escape=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  const metadata=`<title>${escape(brand.pageTitle)}</title>
    <meta name="application-name" content="${escape(brand.applicationName)}" data-react-helmet="true">
    <meta name="description" content="${escape(brand.description)}" data-react-helmet="true">
    <meta name="robots" content="noindex, nofollow" data-react-helmet="true">
    <meta name="theme-color" content="${brand.themeColor}" data-react-helmet="true">
    <meta property="og:title" content="${escape(brand.pageTitle)}" data-react-helmet="true">
    <meta property="og:description" content="${escape(brand.description)}" data-react-helmet="true">
    <meta property="og:site_name" content="${escape(brand.applicationName)}" data-react-helmet="true">
    <link rel="icon" type="${brand.assets.favicon?'image/png':'image/svg+xml'}" href="${escape(brand.assets.favicon||'/api/branding/default-icon.svg')}" data-react-helmet="true">`;
  return template.replace(/<title>[\s\S]*?<\/title>/i,'').replace('</head>',metadata+'\n</head>');
}
