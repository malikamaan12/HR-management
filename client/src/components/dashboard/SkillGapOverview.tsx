import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ArrowUpRight, Award, BookOpen } from "lucide-react";

interface SkillGapData {
  totalSkills: number;
  skillsWithGaps: number;
  gapPercentage: number;
  departmentSkillGaps: {
    department: string;
    gapPercentage: number;
    recommendedCourses: number;
  }[];
  topRecommendedCourses: {
    id: number;
    name: string;
    skillsAddressed: number;
    enrollmentCount: number;
  }[];
}

export default function SkillGapOverview() {
  const { data, isLoading } = useQuery<SkillGapData>({
    queryKey: ['/api/skills/gap-analysis-summary'],
    staleTime: 1000 * 60 * 30,
  });

  return (
    <div className="glass-bento-card p-6 h-full flex flex-col">
      <h3 className="text-xl font-bold text-e3-aurora">Skill Gap Analysis</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Skills assessment and training recommendations</p>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-emerald-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Award className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Total Skills</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.totalSkills}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-amber-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                  <ArrowUpRight className="h-5 w-5 text-amber-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Skills with Gaps</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{data.skillsWithGaps}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-blue-500/10 p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
                  <BookOpen className="h-5 w-5 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Gap Percentage</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.gapPercentage}%</p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="text-sm font-medium mb-3 text-slate-700 dark:text-slate-200">Department Skill Gaps</h4>
              <div className="space-y-3">
                {data.departmentSkillGaps.map((dept, index) => (
                  <div key={index}>
                    <div className="flex justify-between mb-1 min-w-0">
                      <span className="text-sm text-slate-600 dark:text-slate-300 truncate min-w-0">{dept.department}</span>
                      <div className="text-sm flex items-center gap-2 shrink-0 ml-2">
                        <span className={dept.gapPercentage > 30 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}>
                          {dept.gapPercentage}%
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 text-xs truncate">
                          {dept.recommendedCourses} courses
                        </span>
                      </div>
                    </div>
                    <Progress value={100 - dept.gapPercentage} className="h-2" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-sm font-medium mb-3 text-slate-700 dark:text-slate-200">Top Recommended Courses</h4>
              <div className="space-y-2">
                {data.topRecommendedCourses.map((course) => (
                  <div key={course.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="font-medium text-slate-700 dark:text-slate-200 truncate">{course.name}</div>
                    <div className="flex justify-between items-center mt-1 text-xs">
                      <span className="text-slate-500 dark:text-slate-400 truncate min-w-0">Addresses {course.skillsAddressed} skill gaps</span>
                      <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-lg shrink-0 ml-2">
                        {course.enrollmentCount} enrolled
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>No skill gap analysis data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
