import {StatusPill,EmptyState} from '@/components/ux/ModuleVisuals';
import {useLocale} from '@/contexts/LocaleContext';
import { cloneElement, isValidElement, useId, useState, type ReactNode, type ReactElement } from 'react';
import {Button} from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiJson } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
export const fieldClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
export function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { const {t}=useLocale(); const id = useId(); const control = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type); return <div className="block space-y-1 text-sm">{control ? <label htmlFor={id} className="font-medium">{t(label)}</label> : <div className="font-medium">{t(label)}</div>}{control ? cloneElement(children as ReactElement<any>, { id }) : children}</div>; }
export function Section({ title, children }: {
    title: string;
    children: ReactNode;
}) { const {t}=useLocale(); return <section className="module-card space-y-4 rounded-2xl border bg-card p-4 sm:p-5"><h2 className="text-base font-semibold">{t(title)}</h2>{children}</section>; }
export function Table({ headers, rows, pageSize, responsive=true }: {
    headers: string[];
    rows: ReactNode[][];
    pageSize?: number;
    responsive?: boolean;
}) {
 const {t}=useLocale();
 const [page,setPage]=useState(0), size=pageSize&&pageSize>0?pageSize:rows.length||1, pages=Math.max(1,Math.ceil(rows.length/size)), current=Math.min(page,pages-1), shown=rows.slice(current*size,(current+1)*size);
 return <div className="space-y-3"><div className={`module-table-wrap overflow-auto rounded-xl border ${responsive?'module-responsive-table':''}`}><table className="module-table w-full text-sm"><thead><tr>{headers.map((h,i) => <th scope="col" className="bg-muted/60 p-3 text-start text-xs font-medium text-muted-foreground" key={i}>{t(h)||<span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody>{shown.map((row, i) => <tr className="border-t" key={current*size+i}>{row.map((cell, j) => <td data-label={headers[j]||'Actions'} className="p-3 align-top" key={j}><div>{typeof cell==='string'?<StatusPill value={cell}/>:cell}</div></td>)}</tr>)}</tbody></table>{!rows.length && <EmptyState title="No matching records" description="Records will appear here when available."/>}</div>{pageSize&&rows.length>pageSize&&<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>{current*size+1}–{Math.min((current+1)*size,rows.length)} of {rows.length}</span><div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={current===0} onClick={()=>setPage(current-1)}>{t('Previous')}</Button><span>Page {current+1} of {pages}</span><Button type="button" size="sm" variant="outline" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>{t('Next')}</Button></div></div>}</div>;
}
export function useAction(onDone?: () => void) { const cache = useQueryClient(), { toast } = useToast(); return useMutation({ mutationFn: ({ url, body, method = 'POST' }: {
        url: string;
        body: unknown;
        method?: string;
    }) => apiJson(url, { method, body }), onSuccess: () => { cache.invalidateQueries(); onDone?.(); toast({ title: 'Saved successfully' }); }, onError: e => toast({ title: 'Unable to save', description: e.message, variant: 'destructive' }) }); }
export function QueryError({ error }: {
    error: unknown;
}) {
 if(!error)return null;
 const message=error instanceof Error?error.message:'Unable to load records';
 const session=/^401\b/.test(message),denied=/^403\b/.test(message);
 return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm"><div><p className="font-medium">{session?'Your session needs refreshing':denied?'Access unavailable':'Unable to load this information'}</p><p className="mt-1 text-xs text-muted-foreground">{session?'Reload this page to reconnect. You may need to sign in again.':denied?'Your current role or team access does not allow this view.':message}</p></div>{session&&<Button type="button" variant="outline" size="sm" onClick={()=>window.location.reload()}>Reload page</Button>}</div>;
}
export function downloadCsv(name: string, rows: unknown[][]) { const cell = (v: unknown) => '"' + (/^[=+@\-\t\r]/.test(String(v ?? '')) ? "'" : '') + String(v ?? '').replaceAll('"', '""') + '"'; const url = URL.createObjectURL(new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
