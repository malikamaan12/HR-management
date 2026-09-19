import { Badge } from '@/components/ui/badge';
import { FileEdit, Clock, Radio, Archive, CalendarX } from 'lucide-react';
import type { BulletinView } from '@shared/communications';

export const noticeStages = {
  draft: { label: 'Draft', Icon: FileEdit, color: 'text-slate-600 dark:text-slate-300' },
  scheduled: { label: 'Scheduled', Icon: Clock, color: 'text-blue-700 dark:text-blue-300' },
  live: { label: 'Live', Icon: Radio, color: 'text-emerald-700 dark:text-emerald-300' },
  expired: { label: 'Expired', Icon: CalendarX, color: 'text-amber-700 dark:text-amber-300' },
  archived: { label: 'Archived', Icon: Archive, color: 'text-muted-foreground' },
};
export function NoticeStage({ stage }: { stage: BulletinView['stage'] }) {
  const item = noticeStages[stage];
  return <Badge variant="outline" className={`gap-1.5 ${item.color}`}><item.Icon className="h-3 w-3"/>{item.label}</Badge>;
}
export function FilterPills({ items, value, onChange, label }: { items: { value: string; label: string; count?: number }[]; value: string; onChange: (value: string) => void; label: string }) {
  return <div className="flex flex-wrap gap-2" role="group" aria-label={label}>{items.map(item => <button key={item.value} aria-pressed={value === item.value} onClick={() => onChange(item.value)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${value === item.value ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}`}>
    {item.label}{item.count !== undefined && <span className="rounded-full bg-background/20 px-1.5 tabular-nums">{item.count}</span>}
  </button>)}</div>;
}
