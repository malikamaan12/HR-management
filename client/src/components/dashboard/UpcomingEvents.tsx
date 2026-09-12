import { useQuery } from "@tanstack/react-query";
import { formatDate, cn } from "@/lib/utils";

interface EventData {
  id: number;
  name: string;
  startDate: string;
  icon: string;
  iconClass: string;
}

export default function UpcomingEvents() {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/events?status=upcoming'],
    staleTime: 1000 * 60 * 5,
  });



  const events = (data || []) as EventData[];

  return (
    <div className="glass-bento-card p-5 sm:p-6 h-full flex flex-col">
      <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 text-e3-aurora">Event Pulse</h3>
      <div className="space-y-3 flex-1 min-w-0">
        {isLoading ? (
          <div className="text-sm text-slate-400">Loading...</div>
        ) : (
          events.slice(0, 3).map((event: EventData) => (
            <div key={event.id} className="flex items-center p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 hover:border-indigo-200 transition-colors group gap-3 min-w-0">
              <div className={cn("w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-lg text-sm", 'bg-indigo-500')}>
                <i className="fas fa-calendar"></i>
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-bold truncate dark:text-slate-200">{event.name}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">{formatDate(event.startDate)}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <button onClick={()=>window.location.assign("/event-staff")} className="mt-4 sm:mt-6 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors">
        Full Calendar →
      </button>
    </div>
  );
}
