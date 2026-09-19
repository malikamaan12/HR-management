import { useState,useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, QueryError, fieldClass } from '@/components/hr/Operations';
import { apiJson } from '@/lib/queryClient';
export const hub = '/api/communications';
export function useDebounced(value:string){const [current,setCurrent]=useState(value);useEffect(()=>{const timer=setTimeout(()=>setCurrent(value),300);return()=>clearTimeout(timer);},[value]);return current;}
export type Page<T> = { items: T[]; hasMore: boolean };
export type Person = { id: number; name: string; department?: string; kind?: string; current?: boolean; starts_at?: string; ends_at?: string; removed_at?: string };
export const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString() : '—';
export const localDate = (value?: string | null) => { const d = value ? new Date(value) : new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
export function useHubAction(onDone?: (value: any) => void) {
  const cache = useQueryClient();
  return useMutation({ mutationFn: ({ path, body, method = 'POST' }: { path: string; body: unknown; method?: string }) => apiJson<any>(hub + path, { method, body }), onSuccess: value => { cache.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith(hub) }); onDone?.(value); } });
}
export function Pager({ offset, hasMore, onChange }: { offset: number; hasMore?: boolean; onChange: (n: number) => void }) {
  return <div className="flex gap-3"><Button size="sm" variant="outline" disabled={!offset} onClick={() => onChange(Math.max(0,offset-25))}>Previous</Button><Button size="sm" variant="outline" disabled={!hasMore} onClick={() => onChange(offset+25)}>Next</Button></div>;
}
export function PersonPicker({ value, onChange, teams = false }: { value: string; onChange: (s: string) => void; teams?: boolean }) {
  const [q,setQ] = useState(''), [offset,setOffset] = useState(0);
  const people = useQuery<Page<Person>>({ queryKey: [`${hub}/${teams?'teams':'directory'}?q=${encodeURIComponent(q)}&offset=${offset}`] });
  return <div className="space-y-2"><Field label={teams?'Find workforce team':'Find person'}><input className={fieldClass} value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}}/></Field><Field label={teams?'Team':'Person'}><select className={fieldClass} value={value} onChange={e=>onChange(e.target.value)}><option value="">Choose…</option>{value&&!people.data?.items.some(p=>p.id===Number(value))&&<option value={value}>Selected #{value}</option>}{people.data?.items.map(p=><option value={p.id} key={p.id}>{p.name}{p.kind?' · '+p.kind:''}{p.department?' · '+p.department:''}</option>)}</select></Field><QueryError error={people.error}/><Pager offset={offset} hasMore={people.data?.hasMore} onChange={setOffset}/></div>;
}
