import {useEffect, useRef, useState} from 'react';
import {Camera, ImagePlus, Loader2, Trash2} from 'lucide-react';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
import type {ApiEmployeeRecord} from '@/lib/api-types';
import {cn} from '@/lib/utils';

type Person = {firstName:string; lastName:string; photo?:string|null};
export function EmployeeAvatar({employee, className}: {employee:Person; className?:string}) {
  return <Avatar className={cn('employee-avatar',className)}><AvatarImage src={employee.photo||undefined} alt="" loading="lazy" decoding="async" className="object-cover"/><AvatarFallback>{employee.firstName[0]}{employee.lastName[0]}</AvatarFallback></Avatar>;
}

async function preparePhoto(file:File) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024) throw new Error('Choose a JPG, PNG or WebP image up to 10 MB.');
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>40000000) throw new Error('Choose a smaller image, up to 40 megapixels.');
    const canvas=document.createElement('canvas'); canvas.width=320; canvas.height=320;
    const context=canvas.getContext('2d'); if(!context) throw new Error('Image preview is unavailable in this browser.');
    const size=Math.min(bitmap.width,bitmap.height);
    context.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,320,320);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Unable to prepare this image.')),'image/png'));
    if(blob.size>384*1024) throw new Error('Choose a simpler or smaller image.');
    return new File([blob],'employee-photo.png',{type:'image/png'});
  } finally { bitmap.close(); }
}

export default function EmployeePhoto({employee}: {employee:ApiEmployeeRecord}) {
  const [open,setOpen]=useState(false);
  return <><button type="button" className="employee-photo-trigger" aria-label={`${employee.photo?'Preview':'Add'} photo for ${employee.firstName} ${employee.lastName}`} disabled={!employee.photo&&!employee.access.canEdit} onClick={()=>setOpen(true)}><EmployeeAvatar employee={employee} className="h-24 w-24"/>{employee.access.canEdit&&<span className="employee-photo-camera"><Camera className="h-4 w-4"/></span>}</button><div className="employee-photo-caption">{employee.access.canEdit?<Button variant="ghost" size="sm" onClick={()=>setOpen(true)}><Camera className="mr-2 h-4 w-4"/>{employee.photo?'Change photo':'Upload photo'}</Button>:employee.photo&&<Button variant="ghost" size="sm" onClick={()=>setOpen(true)}>Preview photo</Button>}</div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md">{open&&<PhotoEditor key={`${employee.id}-${open}`} employee={employee} onClose={()=>setOpen(false)}/>}</DialogContent></Dialog></>;
}

function PhotoEditor({employee,onClose}:{employee:ApiEmployeeRecord;onClose:()=>void}) {
  const cache=useQueryClient(),{toast}=useToast(),input=useRef<HTMLInputElement>(null),selection=useRef(0);
  const [expectedVersion]=useState(employee.recordVersion);
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[preparing,setPreparing]=useState(false),[error,setError]=useState(''),[remove,setRemove]=useState(false);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  useEffect(()=>()=>{selection.current++;},[]);
  const mutation=useMutation({mutationFn:async()=>{
    if(remove) return apiJson(`/api/employees/${employee.id}/photo`,{method:'DELETE',body:{expectedVersion}});
    if(!file) throw new Error('Choose a photo first.');
    const body=new FormData();body.append('photo',file);body.append('expectedVersion',String(expectedVersion));
    return apiJson(`/api/employees/${employee.id}/photo`,{method:'PUT',body});
  },onSuccess:()=>{cache.invalidateQueries({predicate:query=>typeof query.queryKey[0]==='string'&&query.queryKey[0].startsWith('/api/employees')});toast({title:remove?'Employee photo removed':'Employee photo saved'});onClose();}});
  const choose=async(value:File)=>{
    const current=++selection.current;setPreparing(true);setError('');setRemove(false);
    try {const prepared=await preparePhoto(value);if(current===selection.current)setFile(prepared);}
    catch(error){if(current===selection.current){setFile(null);setError(error instanceof Error?error.message:'Unable to read this image.');}}
    finally{if(current===selection.current)setPreparing(false);}
  };
  return <><DialogHeader><DialogTitle>{employee.access.canEdit?'Employee photo':'Photo preview'}</DialogTitle><DialogDescription>{employee.firstName} {employee.lastName} · {employee.employeeId}</DialogDescription></DialogHeader><div className="photo-preview-stage"><EmployeeAvatar employee={{...employee,photo:remove?null:preview||employee.photo}} className="h-48 w-48 rounded-3xl"/>{preparing&&<span role="status"><Loader2 className="h-5 w-5 animate-spin"/>Preparing preview…</span>}</div>{employee.access.canEdit&&<><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose employee photo" className="sr-only" disabled={preparing||mutation.isPending} onChange={event=>{const value=event.target.files?.[0];event.target.value='';if(value)void choose(value);}}/><Button variant="outline" className="w-full" disabled={preparing||mutation.isPending} onClick={()=>input.current?.click()}><ImagePlus className="mr-2 h-4 w-4"/>{file?'Choose another photo':'Choose photo'}</Button><p className="text-center text-xs text-muted-foreground">JPG, PNG or WebP · up to 10 MB<br/>A square preview is saved for the employee directory.</p>{(error||mutation.error)&&<p role="alert" className="text-sm text-destructive">{error||mutation.error?.message}</p>}{remove&&<p role="status" className="rounded-xl bg-muted p-3 text-sm">The current photo will be removed when you save.</p>}<div className="flex flex-wrap items-center gap-2">{employee.photo&&<Button variant="ghost" disabled={preparing||mutation.isPending} onClick={()=>{setFile(null);setRemove(!remove);}}><Trash2 className="mr-2 h-4 w-4"/>{remove?'Keep photo':'Remove'}</Button>}<div className="ml-auto flex gap-2"><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button><Button disabled={preparing||mutation.isPending||(!file&&!remove)} onClick={()=>mutation.mutate()}>{mutation.isPending?'Saving…':'Save photo'}</Button></div></div></>}</>;
}
