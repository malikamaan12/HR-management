import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import WelcomeBanner from "@/components/dashboard/WelcomeBanner";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";
import AttendanceOverview from "@/components/dashboard/AttendanceOverview";
import ComplianceStatus from "@/components/dashboard/ComplianceStatus";
import UpcomingEvents from "@/components/dashboard/UpcomingEvents";
import { getAccessScope, hasPermission } from "@shared/permissions";
import EmployeeDashboard from "./EmployeeDashboard";

export default function Dashboard() {
  const { user } = useAuth();
  const selfView = !!user && ['employee','permanent_employee','temporary_staff','contract_employee'].includes(user.role);
  const { data: stats, isLoading,error } = useQuery<{employeeCount:number;activeLeaves:number;expiringDocuments:number;upcomingEvents:number}>({
    queryKey: ['/api/dashboard/stats'], enabled:!selfView,
    staleTime: 1000 * 60,
  });

  if(selfView)return <EmployeeDashboard/>;
  if(isLoading)return <p>Loading dashboard…</p>;
  if(error || !stats)return <p role="alert">Unable to load dashboard data.</p>;
  const dashboardStats=stats;
  const canReadActivity = !!user && hasPermission(user.role, 'system_configuration', 'read') && getAccessScope(user.role, 'system_configuration') === 'all';
  const canReadEvents = !!user && hasPermission(user.role, 'event_staff_management', 'read') && ['all', 'event_staff'].includes(getAccessScope(user.role, 'event_staff_management'));

  return (
    <div className="space-y-6 pb-12 max-w-full overflow-hidden">
      <WelcomeBanner stats={dashboardStats as any} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="md:col-span-2">
          <QuickActions />
        </div>
        {user && hasPermission(user.role, 'compliance_documents', 'read') && <div className="md:col-span-1">
          <ComplianceStatus />
        </div>}
        {canReadEvents && <div className="md:col-span-1">
          <UpcomingEvents />
        </div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {user && hasPermission(user.role, 'attendance_time_tracking', 'read') && <AttendanceOverview />}
        {canReadActivity && <RecentActivity />}
      </div>

    </div>
  );
}
