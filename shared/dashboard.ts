export type DashboardBreakdown = { name: string; count: number };
export type DashboardOverview = {
  generatedAt: string; today: string; from: string; days: number; timezone: string; company: string; expiryDays: number;
  unavailable: string[];
  people: null | { total: number; active: number; joined: number; departments: DashboardBreakdown[]; types: DashboardBreakdown[]; recent: { id: number; name: string; department: string; position: string; date: string }[] };
  attendance: null | { today: number; working: number; pending: number; minutes: number; overtime: number; previousMinutes: number; trend: { date: string; present: number; late: number; absent: number; onLeave: number }[] };
  leave: null | { away: number; pending: number; statuses: DashboardBreakdown[]; upcoming: { id: number; name: string; start: string; end: string; days: number; type: string }[] };
  documents: null | { total: number; expired: number; expiring: number; healthy: number; upcoming: { id: number; name: string; type: string; date: string }[] };
  learning: null | { active: number; overdue: number; completed: number; awaiting: number; statuses: DashboardBreakdown[]; upcoming: { id: number; name: string; title: string; date: string | null; progress: number }[] };
  payroll: null | { statuses: DashboardBreakdown[]; totals: { currency: string; processed: string; awaiting: string }[]; trend: { month: string; currency: string; total: string }[] };
  workforce: null | { teams: number; shifts: number; required: number; accepted: number; gaps: number; breakdown: DashboardBreakdown[]; upcoming: { id: number; team: string; role: string; site: string; start: string; end: string; timezone: string; required: number; accepted: number }[]; own: { id: number; team: string; role: string; site: string; start: string; end: string; timezone: string; status: string }[] };
};
