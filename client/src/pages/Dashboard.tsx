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
import {Link} from 'wouter';
import {workforceAdmin} from '@shared/workforce';

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
      {user&&workforceAdmin(user.role)&&<section className="rounded-lg border bg-card p-5"><h2 className="text-lg font-semibold">Teams, venues & organization charts</h2><p className="mt-1 text-sm text-muted-foreground">Create and manage FECs, events, mall activations and head-office reporting teams.</p><div className="mt-4 flex flex-wrap gap-4"><Link className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground" href="/org-charts">Manage teams & org charts</Link><Link className="rounded border px-4 py-2 text-sm" href="/workforce">Manage sites, rosters & team access</Link></div></section>}

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
