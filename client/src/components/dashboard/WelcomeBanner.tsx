import { useAuth } from "@/contexts/AuthContext";
import { Users, Calendar, FileText, AlertCircle } from "lucide-react";

interface WelcomeBannerProps {
  stats: {
    employeeCount: number;
    activeLeaves: number;
    upcomingEvents: number;
    expiringDocuments: number;
  }
}

export default function WelcomeBanner({ stats }: WelcomeBannerProps) {
  const { user } = useAuth();
  
  return (
    <div className="relative overflow-hidden rounded-3xl bg-e3-aurora p-6 sm:p-8 text-white shadow-2xl">
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-[60px] rounded-full -mr-32 -mt-32" />
      
      <div className="relative z-10 flex flex-col gap-6">
        <div className="space-y-2 min-w-0">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight truncate">
            Welcome back, {user?.firstName || 'User'}!
          </h1>
          <p className="text-white/80 text-base sm:text-lg">
            Here's what's happening with your workforce today.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 sm:p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 sm:h-5 sm:w-5 text-teal-300 shrink-0" />
              <span className="text-white/70 text-xs sm:text-sm font-medium truncate">Headcount</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.employeeCount}</div>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 sm:p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-300 shrink-0" />
              <span className="text-white/70 text-xs sm:text-sm font-medium truncate">On Leave</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.activeLeaves}</div>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 sm:p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-purple-300 shrink-0" />
              <span className="text-white/70 text-xs sm:text-sm font-medium truncate">Expiring</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.expiringDocuments}</div>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 sm:p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-pink-300 shrink-0" />
              <span className="text-white/70 text-xs sm:text-sm font-medium truncate">Events</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.upcomingEvents}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
