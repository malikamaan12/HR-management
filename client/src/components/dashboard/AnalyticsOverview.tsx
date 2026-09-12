import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { FileBarChart } from "lucide-react";

interface AnalyticsData {
  employeesByDepartment: {
    department: string;
    count: number;
  }[];
  attendanceStats: {
    status: string;
    percentage: number;
  }[];
  recentReports: {
    id: number;
    name: string;
    createdAt: string;
    runCount: number;
  }[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export default function AnalyticsOverview() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['/api/analytics/dashboard-stats'],
    staleTime: 1000 * 60 * 10,
  });

  return (
    <div className="glass-bento-card p-6 h-full flex flex-col">
      <h3 className="text-xl font-bold text-e3-aurora">Analytics & Reporting</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Key metrics and recent reports</p>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-medium mb-2 text-slate-700 dark:text-slate-200">Employee Distribution by Department</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.employeesByDepartment}
                    margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
                  >
                    <XAxis
                      dataKey="department"
                      angle={-45}
                      textAnchor="end"
                      height={60}
                      style={{ fontSize: '12px' }}
                    />
                    <YAxis style={{ fontSize: '12px' }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8884d8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium mb-2 text-slate-700 dark:text-slate-200">Attendance Overview</h4>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.attendanceStats}
                        dataKey="percentage"
                        nameKey="status"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {data.attendanceStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `${value}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2 text-slate-700 dark:text-slate-200">Recent Reports</h4>
                <div className="space-y-2">
                  {data.recentReports.map((report) => (
                    <div key={report.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-800/30">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileBarChart className="h-4 w-4 text-indigo-500 shrink-0" />
                        <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{report.name}</span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {new Date(report.createdAt).toLocaleDateString()}
                        </span>
                        <span className="text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-lg">
                          Run count: {report.runCount}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>No analytics data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
