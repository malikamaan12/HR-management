import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Star, ClipboardCheck, CalendarClock } from "lucide-react";

interface PerformanceData {
  avgRating: number;
  totalReviews: number;
  upcomingReviews: number;
  performanceTrends: {
    category: string;
    score: number;
    change: number;
  }[];
}

export default function PerformanceOverview() {
  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ['/api/performance/dashboard-stats'],
    staleTime: 1000 * 60 * 5,
  });

  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-green-600";
    if (score >= 70) return "text-blue-600";
    if (score >= 50) return "text-amber-600";
    return "text-red-600";
  };

  const getChangeIndicator = (change: number) => {
    if (change > 0) return <span className="text-green-600 dark:text-green-400">↑ {change}%</span>;
    if (change < 0) return <span className="text-red-600 dark:text-red-400">↓ {Math.abs(change)}%</span>;
    return <span className="text-slate-500 dark:text-slate-400">→ 0%</span>;
  };

  return (
    <div className="glass-bento-card p-6 h-full flex flex-col">
      <h3 className="text-xl font-bold text-e3-aurora">Performance Management</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Employee performance metrics and upcoming reviews</p>

      <div className="flex-1">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-indigo-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center shrink-0">
                  <Star className="h-5 w-5 text-indigo-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Avg Rating</p>
                  <p className={`text-2xl font-bold ${getScoreColor(data.avgRating)}`}>
                    {data.avgRating}%
                  </p>
                </div>
              </div>
              <div className="rounded-2xl bg-emerald-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <ClipboardCheck className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Total Reviews</p>
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{data.totalReviews}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-amber-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                  <CalendarClock className="h-5 w-5 text-amber-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Upcoming</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{data.upcomingReviews}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <p className="font-medium text-slate-700 dark:text-slate-200">Performance by Category</p>
              {data.performanceTrends.map((item, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between min-w-0">
                    <span className="text-sm text-slate-600 dark:text-slate-300 truncate min-w-0">{item.category}</span>
                    <span className="text-sm font-medium flex items-center gap-2 shrink-0">
                      {item.score}% {getChangeIndicator(item.change)}
                    </span>
                  </div>
                  <Progress value={item.score} className="h-2" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>No performance data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
