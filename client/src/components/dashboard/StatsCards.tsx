import { Card, CardContent } from "@/components/ui/card";

interface StatsCardProps {
  icon: string;
  iconClass: string;
  title: string;
  value: string | number;
}

function StatsCard({ icon, iconClass, title, value }: StatsCardProps) {
  return (
    <div className="flex items-center p-4 border rounded-md border-neutral-200">
      <div className={`w-12 h-12 ${iconClass} rounded-full flex items-center justify-center`}>
        <i className={`${icon} text-xl`}></i>
      </div>
      <div className="ml-4">
        <p className="text-neutral-500 text-sm">{title}</p>
        <p className="font-semibold text-lg">{value}</p>
      </div>
    </div>
  );
}

interface StatsCardsProps {
  stats: {
    totalEmployees: number;
    presentToday: number;
    documentAlerts: number;
    pendingLeaves?: number;
    upcomingEvents?: number;
    expiringVisas?: number;
  };
}

export default function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatsCard
        icon="fas fa-user-plus"
        iconClass="bg-primary/10 text-primary"
        title="Total Employees"
        value={stats.totalEmployees}
      />
      <StatsCard
        icon="fas fa-calendar-check"
        iconClass="bg-success/10 text-success"
        title="Present Today"
        value={stats.presentToday}
      />
      <StatsCard
        icon="fas fa-file-alt"
        iconClass="bg-warning/10 text-warning"
        title="Document Alerts"
        value={stats.documentAlerts}
      />
      {stats.pendingLeaves !== undefined && (
        <StatsCard
          icon="fas fa-umbrella-beach"
          iconClass="bg-info/10 text-info"
          title="Pending Leaves"
          value={stats.pendingLeaves}
        />
      )}
      {stats.upcomingEvents !== undefined && (
        <StatsCard
          icon="fas fa-calendar-day"
          iconClass="bg-primary/10 text-primary"
          title="Upcoming Events"
          value={stats.upcomingEvents}
        />
      )}
      {stats.expiringVisas !== undefined && (
        <StatsCard
          icon="fas fa-passport"
          iconClass="bg-error/10 text-error"
          title="Expiring Visas"
          value={stats.expiringVisas}
        />
      )}
    </div>
  );
}
