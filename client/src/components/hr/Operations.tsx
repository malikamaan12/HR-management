import {TitleIcon,StatusPill,EmptyState} from '@/components/ux/ModuleVisuals';
import { cloneElement, isValidElement, useId, type ReactNode, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiJson } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
export const fieldClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
export function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { const id = useId(); const control = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type); return <div className="block space-y-1 text-sm">{control ? <label htmlFor={id} className="font-medium">{label}</label> : <div className="font-medium">{label}</div>}{control ? cloneElement(children as ReactElement<any>, { id }) : children}</div>; }
export function Section({ title, children }: {
    title: string;
    children: ReactNode;
}) { return <section className="module-card space-y-4 rounded-2xl border bg-card p-5 sm:p-6"><h2 className="flex items-center gap-3 text-lg font-semibold"><TitleIcon title={title}/>{title}</h2>{children}</section>; }
export function Table({ headers, rows }: {
    headers: string[];
    rows: ReactNode[][];
}) { return <div className="module-table-wrap overflow-auto rounded-xl border"><table className="module-table w-full text-sm"><thead><tr>{headers.map(h => <th scope="col" className="bg-muted/60 p-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr className="border-t" key={i}>{row.map((cell, j) => <td className="p-3 align-top" key={j}>{typeof cell==='string'?<StatusPill value={cell}/>:cell}</td>)}</tr>)}</tbody></table>{!rows.length && <EmptyState title="No records yet" description="Records will appear here when they are available for your selection."/>}</div>; }
export function useAction(onDone?: () => void) { const cache = useQueryClient(), { toast } = useToast(); return useMutation({ mutationFn: ({ url, body, method = 'POST' }: {
        url: string;
        body: unknown;
        method?: string;
    }) => apiJson(url, { method, body }), onSuccess: () => { cache.invalidateQueries(); onDone?.(); toast({ title: 'Saved successfully' }); }, onError: e => toast({ title: 'Unable to save', description: e.message, variant: 'destructive' }) }); }
export function QueryError({ error }: {
    error: unknown;
}) { return error ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : 'Unable to load records'}</p> : null; }
export function downloadCsv(name: string, rows: unknown[][]) { const cell = (v: unknown) => '"' + (/^[=+@\-\t\r]/.test(String(v ?? '')) ? "'" : '') + String(v ?? '').replaceAll('"', '""') + '"'; const url = URL.createObjectURL(new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
