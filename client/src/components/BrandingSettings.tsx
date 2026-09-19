import {useEffect,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {ImagePlus,Sun,Moon,Globe,Palette} from 'lucide-react';
import {assetKeys,brandingSchema,maxBrandingBytes,type Branding,type BrandingAsset,type PublicBranding} from '@shared/branding';
import {useBranding} from './Branding';
import {apiJson} from '@/lib/queryClient';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/hooks/use-toast';

const labels={lightLogo:'Light-mode logo',darkLogo:'Dark-mode logo',favicon:'Browser favicon'};
function AssetPreview({file,url,dark,label}:{file?:File;url?:string;dark:boolean;label:string}){
  const [local,setLocal]=useState('');
  useEffect(()=>{if(!file){setLocal('');return;}const next=URL.createObjectURL(file);setLocal(next);return()=>URL.revokeObjectURL(next);},[file]);
  return <div className={`flex h-28 items-center justify-center rounded-xl border p-4 ${dark?'bg-slate-950 text-slate-100':'bg-white text-slate-700'}`}>{local||url?<img src={local||url} alt={`${label} preview`} className="max-h-full max-w-full object-contain"/>:<div className="text-center text-xs"><ImagePlus className="mx-auto mb-2 h-6 w-6"/>No custom image</div>}</div>;
}
export default function BrandingSettings(){
  const query=useBranding();
  return <Card><CardHeader><CardTitle><span className="flex items-center gap-2"><Palette className="h-5 w-5"/>Application branding</span></CardTitle><p className="text-sm text-muted-foreground">Manage the identity people see when they sign in and use this workspace.</p></CardHeader><CardContent>{query.error?<div role="alert">Unable to load branding. <Button variant="outline" onClick={()=>void query.refetch()}>Try again</Button></div>:query.data?<BrandingForm initial={query.data}/>:<p role="status">Loading branding…</p>}</CardContent></Card>;
}
function BrandingForm({initial}:{initial:PublicBranding}){
  // Keep the loaded version while editing, so background refreshes cannot overwrite unsaved work.
  const [saved,setSaved]=useState(initial),[form,setForm]=useState<Branding>(brandingSchema.parse(initialWithoutAssets(initial))),[files,setFiles]=useState<Partial<Record<BrandingAsset,File>>>({}),[remove,setRemove]=useState<BrandingAsset[]>([]),[revision,setRevision]=useState(0),[error,setError]=useState('');
  const cache=useQueryClient(),{toast}=useToast();
  function load(value:PublicBranding){setSaved(value);setForm(brandingSchema.parse(initialWithoutAssets(value)));setFiles({});setRemove([]);setRevision(value=>value+1);setError('');}
  const save=useMutation({mutationFn:async()=>{
    const settings=brandingSchema.safeParse(form);if(!settings.success)throw new Error(settings.error.issues[0].message);
    const body=new FormData();body.append('settings',JSON.stringify({settings:settings.data,version:saved.version,remove}));for(const key of assetKeys)if(files[key])body.append(key,files[key]!);
    return apiJson<PublicBranding>('/api/branding',{method:'PUT',body});
  },onSuccess:value=>{cache.setQueryData(['/api/branding'],value);load(value);toast({title:'Branding saved',description:'Your workspace name, logos and browser identity are updated.'});},onError:error=>setError(error.message)});
  return <form className="space-y-6" onSubmit={e=>{e.preventDefault();setError('');save.mutate();}}>
    <fieldset disabled={save.isPending} className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">{(['applicationName','shortName','tagline'] as const).map(key=><label key={key} className="space-y-1 block"><span className="text-sm font-medium">{{applicationName:'Application name',shortName:'Short name / fallback logo',tagline:'Navigation tagline'}[key]}</span><Input required={key!=='tagline'} maxLength={{applicationName:60,shortName:8,tagline:100}[key]} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}<label className="space-y-1 block"><span className="text-sm font-medium">Browser theme color</span><div className="flex gap-3 items-center"><input aria-label="Browser theme color" type="color" value={form.themeColor} onChange={e=>setForm({...form,themeColor:e.target.value})} className="h-10 w-16 rounded border"/><span className="text-sm font-mono">{form.themeColor}</span></div></label></div>
    <section className="space-y-3"><h3 className="font-semibold">Logos & browser icon</h3><p className="text-sm text-muted-foreground">Upload transparent PNGs, up to 512 KB and 2048 × 2048 pixels. Favicons must be square, 16–512 pixels. Images become public on the sign-in page. If one theme logo is missing, the other is used.</p><div className="grid gap-4 lg:grid-cols-3">{assetKeys.map(key=>{const Icon=key==='lightLogo'?Sun:key==='darkLogo'?Moon:Globe;return <div key={key} className="rounded-xl border p-4 space-y-3"><h4 className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4"/>{labels[key]}</h4><AssetPreview file={files[key]} url={remove.includes(key)?undefined:saved.assets[key]} dark={key==='darkLogo'} label={labels[key]}/><label className="block text-sm"><span className="sr-only">Upload {labels[key]}</span><Input key={revision} type="file" accept="image/png,.png" className="h-auto text-xs" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>maxBrandingBytes||!file.name.toLowerCase().endsWith('.png')){setError('Choose a PNG no larger than 512 KB.');e.target.value='';return;}setFiles(value=>({...value,[key]:file}));setRemove(value=>value.filter(item=>item!==key));setError('');}}/></label>{(files[key]||saved.assets[key])&&!remove.includes(key)&&<Button type="button" variant="outline" size="sm" onClick={()=>{setFiles(value=>({...value,[key]:undefined}));setRemove(value=>[...value.filter(item=>item!==key),key]);setRevision(value=>value+1);}}>Remove {key==='favicon'?'favicon':'logo'}</Button>}{remove.includes(key)&&<p className="text-xs text-muted-foreground">Will be removed when you save.</p>}</div>;})}</div></section>
    <section className="rounded-xl border p-4 space-y-4"><h3 className="font-semibold">Page title & search metadata</h3><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1"><span className="text-sm font-medium">Sign-in page title</span><Input required maxLength={100} value={form.pageTitle} onChange={e=>setForm({...form,pageTitle:e.target.value})}/></label><label className="space-y-1"><span className="text-sm font-medium">Page description</span><textarea className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={3} maxLength={300} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label></div><div className="rounded-lg bg-muted p-4"><p className="text-xs text-muted-foreground mb-2">Title & description preview</p><p className="font-semibold text-primary break-words">{form.pageTitle}</p><p className="text-sm break-words">{form.description}</p></div><p className="text-xs text-muted-foreground">Module tabs use “Page name | Application name”. Metadata is included in the page HTML. This private HR workspace stays excluded from search indexing.</p></section>
    </fieldset>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button disabled={save.isPending} type="submit">{save.isPending?'Saving branding…':'Save branding'}</Button><Button disabled={save.isPending} type="button" variant="outline" onClick={async()=>{try{load(await apiJson<PublicBranding>('/api/branding'));}catch{setError('Unable to reload branding. Try again.');}}}>Discard edits & reload</Button></div>
  </form>;
}
function initialWithoutAssets(value:PublicBranding){const {version,assets,...settings}=value;return settings;}
