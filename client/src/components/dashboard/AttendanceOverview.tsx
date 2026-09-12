import {useQuery} from '@tanstack/react-query';
import type {ApiAttendance} from '@/lib/api-types';
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";



export default function AttendanceOverview() {
  const { theme } = useTheme();
  const {data:records=[]}=useQuery<ApiAttendance[]>({queryKey:['/api/attendance/date/'+new Date().toISOString().slice(0,10)]});
  const data=['present','late','absent','on_leave'].map(status=>({name:status.replace('_',' '),permanent:records.filter(row=>row.status===status).length}));
  
  return (
    <div className="glass-bento-card p-5 sm:p-6 h-full flex flex-col" style={{ minHeight: '350px' }}>
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2 flex-wrap">
        <h3 className="text-lg sm:text-xl font-bold text-e3-aurora">Today's attendance</h3>
        <div className="flex gap-3 sm:gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#6A4FB3] shrink-0" />
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500">Records</span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 w-full" style={{ minHeight: '250px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorPerm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6A4FB3" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6A4FB3" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorEvent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#46A6A9" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#46A6A9" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{fill: theme === 'dark' ? '#94a3b8' : '#64748b', fontSize: 11}}
            />
            <YAxis hide />
            <Tooltip 
              contentStyle={{
                backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
                border: 'none',
                borderRadius: '12px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                fontSize: '12px'
              }}
            />
            <Area type="monotone" dataKey="permanent" stroke="#6A4FB3" strokeWidth={2} fillOpacity={1} fill="url(#colorPerm)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
