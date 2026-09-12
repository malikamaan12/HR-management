import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Shield, User, Users } from "lucide-react";

interface RolePermissionData {
  totalRoles: number;
  totalPermissions: number;
  roleDistribution: {
    roleName: string;
    userCount: number;
  }[];
  recentSecurityLogs: {
    id: number;
    action: string;
    userId: number;
    userType: string;
    timestamp: string;
    status: string;
  }[];
}

export default function RolePermissionOverview() {
  const { data, isLoading } = useQuery<RolePermissionData>({
    queryKey: ['/api/roles/dashboard-stats'],
    staleTime: 1000 * 60 * 15,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-500/10 text-green-600 dark:text-green-400';
      case 'warning': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
      case 'error': return 'bg-red-500/10 text-red-600 dark:text-red-400';
      default: return 'bg-slate-500/10 text-slate-600 dark:text-slate-400';
    }
  };

  return (
    <div className="glass-bento-card p-6 h-full flex flex-col">
      <h3 className="text-xl font-bold text-e3-aurora">Role & Permission Management</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Access control and security insights</p>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-blue-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                  <Users className="h-5 w-5 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Total Roles</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.totalRoles}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-purple-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                  <Shield className="h-5 w-5 text-purple-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Total Permissions</p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{data.totalPermissions}</p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2 text-slate-700 dark:text-slate-200">Role Distribution</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.roleDistribution.map((role, index) => (
                  <div key={index} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <User className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="text-slate-700 dark:text-slate-200 truncate">{role.roleName}</span>
                    </div>
                    <span className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg shrink-0 ml-2">
                      {role.userCount} users
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-sm font-medium mb-2 text-slate-700 dark:text-slate-200">Recent Security Activity</h4>
              <div className="space-y-3">
                {data.recentSecurityLogs.map((log) => (
                  <div key={log.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{log.action}</span>
                          <span className={`text-xs px-2.5 py-1 rounded-lg shrink-0 ${getStatusColor(log.status)}`}>
                            {log.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                          User {log.userId} ({log.userType}) • {new Date(log.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>No role & permission data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
