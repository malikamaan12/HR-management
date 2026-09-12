import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

interface QuickActionItemProps {
  icon: string;
  label: string;
  onClick: () => void;
}

function QuickActionItem({ icon, label, onClick }: QuickActionItemProps) {
  return (
    <button 
      className="flex flex-col items-center justify-center p-3 sm:p-4 bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10 transition-all group min-w-0"
      onClick={onClick}
    >
      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center mb-2 sm:mb-3 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/30 transition-colors shrink-0">
        <i className={cn(icon, "text-indigo-600 dark:text-indigo-400 text-lg sm:text-xl")}></i>
      </div>
      <span className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate w-full text-center">{label}</span>
    </button>
  );
}

export default function QuickActions() {
  const [, navigate] = useLocation();

  return (
    <div className="glass-bento-card p-5 sm:p-6 h-full">
      <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 text-e3-aurora">Command Center</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <QuickActionItem 
          icon="fas fa-user-plus" 
          label="Add Staff"
          onClick={() => navigate("/employees")}
        />
        <QuickActionItem 
          icon="fas fa-clock" 
          label="Attendance"
          onClick={() => navigate("/attendance")}
        />
        <QuickActionItem 
          icon="fas fa-file-invoice-dollar" 
          label="Payroll"
          onClick={() => navigate("/payroll")}
        />
        <QuickActionItem 
          icon="fas fa-cloud-upload-alt" 
          label="Upload Docs"
          onClick={() => navigate("/documents")}
        />
        <QuickActionItem 
          icon="fas fa-shield-alt" 
          label="Security"
          onClick={() => navigate("/user-management")}
        />
        <button 
          className="flex flex-col items-center justify-center p-3 sm:p-4 bg-e3-aurora rounded-2xl text-white shadow-lg hover:shadow-indigo-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] min-w-0"
          onClick={() => navigate("/recruitment")}
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center mb-2 sm:mb-3 shrink-0">
            <i className="fas fa-plus text-lg sm:text-xl"></i>
          </div>
          <span className="text-xs sm:text-sm font-bold truncate w-full text-center">New Requisition</span>
        </button>
      </div>
    </div>
  );
}
