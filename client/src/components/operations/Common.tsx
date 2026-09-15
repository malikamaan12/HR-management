import {type ReactNode} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
export const selectStyle='w-full rounded border bg-background p-2 text-sm';
export function Field({label,children}:{label:string;children:ReactNode}){return <label className="grid gap-1 text-sm">{label}{children}</label>;}
export function useOperation(){const cache=useQueryClient(),{toast}=useToast();return useMutation({mutationFn:({url,body}:{url:string;body:unknown})=>apiJson<any>(url,{method:'POST',body}),onSuccess:async(data,_variables)=>{if(_variables.body&&(typeof _variables.body==='object')&&'preview' in _variables.body&&_variables.body.preview)return;await cache.invalidateQueries({predicate:q=>['/api/attendance','/api/leaves','/api/payroll','/api/timesheets','/api/employee/profile','/api/employee/dashboard'].some(p=>String(q.queryKey[0]).startsWith(p))});toast({title:'Saved'});},onError:(error:Error)=>toast({title:'Unable to complete action',description:error.message,variant:'destructive'})});}
export const today=()=>new Date().toISOString().slice(0,10);
