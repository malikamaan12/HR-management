import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { GraduationCap, Users, TrendingUp } from "lucide-react";

interface TrainingData {
  totalCourses: number;
  activeEnrollments: number;
  completionRate: number;
  topCourses: {
    id: number;
    name: string;
    enrollmentCount: number;
    completionRate: number;
  }[];
}

export default function TrainingOverview() {
  const { data, isLoading } = useQuery<TrainingData>({
    queryKey: ['/api/training/dashboard-stats'],
    staleTime: 1000 * 60 * 5,
  });

  return (
    <div className="glass-bento-card p-6 h-full flex flex-col">
      <h3 className="text-xl font-bold text-e3-aurora">Training & Learning Management</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Course enrollments and completion statistics</p>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-blue-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                  <GraduationCap className="h-5 w-5 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Available Courses</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.totalCourses}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-emerald-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Users className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Active Enrollments</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.activeEnrollments}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-purple-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Avg. Completion</p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{data.completionRate}%</p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="text-sm font-medium mb-3 text-slate-700 dark:text-slate-200">Top Courses by Enrollment</h4>
              <div className="space-y-4">
                {data.topCourses.map((course) => (
                  <div key={course.id}>
                    <div className="flex justify-between mb-1 min-w-0">
                      <span className="text-sm text-slate-600 dark:text-slate-300 truncate min-w-0" title={course.name}>
                        {course.name}
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0 ml-2">
                        {course.enrollmentCount} enrolled
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={course.completionRate} className="h-2" />
                      <span className="text-xs text-slate-600 dark:text-slate-400 shrink-0">
                        {course.completionRate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>No training data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
