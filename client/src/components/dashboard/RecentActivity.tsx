import { useQuery } from "@tanstack/react-query";
import { formatDateTime, cn } from "@/lib/utils";

interface Activity {
  id: number;
  userId: number | null;
  action: string;
  details: string;
  entityType: string;
  entityId: number;
  createdAt: string;
  user?: { name: string };
  type?: 'teal' | 'indigo';
  icon?: string;
}

export default function RecentActivity() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['/api/activity-logs/recent'],
    staleTime: 1000 * 60,
  });



  const logs = (data || []) as Activity[];

  return (
    <div className="glass-bento-card p-5 sm:p-6 h-full flex flex-col">
      <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 text-e3-aurora">Recent Alerts</h3>
      <div className="space-y-3 flex-1 overflow-hidden min-w-0">
        {isLoading ? (
          <div className="text-sm text-slate-400">Loading...</div>
        ) : (
          isError ? <p>Unable to load activity.</p> : logs.length===0 ? <p>No recent activity.</p> : logs.slice(0, 5).map((log: any) => (
            <div key={log.id} className="flex items-start gap-3 p-2.5 sm:p-3 rounded-2xl hover:bg-white/50 dark:hover:bg-white/5 transition-colors group min-w-0">
              <div className={cn(
                "w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm text-sm",
                log.type === 'teal' ? 'bg-teal-500/10 text-teal-600' : 'bg-indigo-500/10 text-indigo-600'
              )}>
                <i className={log.icon || "fas fa-bell"}></i>
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex justify-between items-start mb-0.5 gap-2">
                  <h4 className="text-sm font-bold dark:text-slate-200 truncate min-w-0">{log.action}</h4>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">{formatDateTime(log.createdAt)}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{log.details}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
