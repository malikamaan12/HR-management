import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, SmartphoneCharging, Users } from "lucide-react";

interface MobileIntegrationData {
  activeUsers: number;
  totalUsers: number;
  activePercentage: number;
  mobileCheckInsToday: number;
  mobileLeaveRequests: number;
  recentActivities: {
    id: number;
    action: string;
    timestamp: string;
    deviceType: string;
    status: string;
  }[];
}

export default function MobileIntegrationOverview() {
  const { data, isLoading } = useQuery<MobileIntegrationData>({
    queryKey: ['/api/mobile/dashboard-stats'],
    staleTime: 1000 * 60 * 5,
  });

  const getStatusStyle = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-500/10 text-green-600 dark:text-green-400';
      case 'pending':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
      case 'failed':
        return 'bg-red-500/10 text-red-600 dark:text-red-400';
      default:
        return 'bg-slate-500/10 text-slate-600 dark:text-slate-400';
    }
  };

  return (
    <div className="glass-bento-card p-6 h-full flex flex-col">
      <h3 className="text-xl font-bold text-e3-aurora">Mobile Integration</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Mobile app usage and activity metrics</p>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
            <Skeleton className="h-20 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-blue-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                  <Users className="h-5 w-5 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Active Mobile Users</p>
                  <div className="flex items-end gap-2">
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.activeUsers}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">of {data.totalUsers}</p>
                  </div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">{data.activePercentage}% adoption rate</p>
                </div>
              </div>

              <div className="rounded-2xl bg-emerald-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Mobile Check-ins Today</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.mobileCheckInsToday}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-purple-500/10 p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-purple-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Mobile Leave Requests</p>
                <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{data.mobileLeaveRequests} this month</p>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="text-sm font-medium mb-3 text-slate-700 dark:text-slate-200">
                <div className="flex items-center gap-2">
                  <SmartphoneCharging className="h-4 w-4" />
                  <span>Recent Mobile Activities</span>
                </div>
              </h4>
              <div className="space-y-3">
                {data.recentActivities.map((activity) => (
                  <div key={activity.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="flex justify-between items-center gap-2 min-w-0">
                      <span className="font-medium text-slate-700 dark:text-slate-200 truncate min-w-0">{activity.action}</span>
                      <span className={`text-xs px-2.5 py-1 rounded-lg shrink-0 ${getStatusStyle(activity.status)}`}>
                        {activity.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                      <span>{new Date(activity.timestamp).toLocaleString()}</span>
                      <span className="mx-2">•</span>
                      <span>{activity.deviceType}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>No mobile integration data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
