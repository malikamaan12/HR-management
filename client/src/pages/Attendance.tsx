import { useAuth } from '@/contexts/AuthContext';
import { officeScheduleSummary, type CompanySettings } from '@shared/settings';
import type { ApiAttendance, ApiEmployee, ApiShift, ApiGeofence } from '@/lib/api-types';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Calendar, 
  Clock,
  Map, 
  BarChart4,
  Users,
  CheckCircle2,
  AlertCircle,
  Calendar as CalendarIcon,
  MapPin,
  QrCode,
  Fingerprint,
  Smartphone,
  ClipboardList,
  Plus,
  Edit,
  Timer,
  UserRound,
  Building2,
  CalendarCheck
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Attendance() {
  const {data:self}=useQuery<ApiEmployee>({queryKey:['/api/employee/profile']});
  const {data:policy}=useQuery<CompanySettings>({queryKey:['/api/settings/company'],enabled:self?.workSchedule==='management_office'});
  const [activeTab, setActiveTab] = useState("time-clock"); // Start with clock in/out tab
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance Management</h1>
          <p className="text-muted-foreground">
            Record, manage, and monitor employee attendance efficiently
          </p>
        </div>
      </div>

      {self?.workSchedule==='management_office' && policy && <p className="rounded-md border bg-muted p-3 text-sm">Your management office schedule: {officeScheduleSummary(policy.managementOfficeSchedule)}</p>}
      <Tabs defaultValue="time-clock" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="daily-records" className="flex items-center gap-2">
            <Clock size={16} /> Daily Records
          </TabsTrigger>
          <TabsTrigger value="time-clock" className="flex items-center gap-2">
            <CheckCircle2 size={16} /> Clock In/Out
          </TabsTrigger>
          <TabsTrigger value="shifts" className="flex items-center gap-2">
            <Calendar size={16} /> Shift Scheduling
          </TabsTrigger>
          <TabsTrigger value="geofencing" className="flex items-center gap-2">
            <Map size={16} /> Geofencing
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-2">
            <BarChart4 size={16} /> Reports
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="daily-records" className="space-y-4">
          <DailyAttendance />
        </TabsContent>
        
        <TabsContent value="time-clock" className="space-y-4">
          <ClockInOut />
        </TabsContent>
        
        <TabsContent value="shifts" className="space-y-4">
          <ShiftScheduling />
        </TabsContent>
        
        <TabsContent value="geofencing" className="space-y-4">
          <GeofencingManagement />
        </TabsContent>
        
        <TabsContent value="reports" className="space-y-4">
          <AttendanceReports />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DailyAttendance() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Fetch attendance data for the selected date
  const { data: attendanceData, isLoading } = useQuery<ApiAttendance[]>({
    queryKey: [`/api/attendance/date/${selectedDate}`],
    staleTime: 1000 * 60, // 1 minute
  });

  // Manual attendance recording dialog
  const [isManualRecordOpen, setIsManualRecordOpen] = useState(false);
  
  // Mutation for recording attendance
  const recordAttendanceMutation = useMutation({
    mutationFn: (newAttendance: any) => {
      return apiRequest('/api/attendance', {
        method: 'POST',
        body: JSON.stringify(newAttendance),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Attendance record saved successfully.",
      });
      setIsManualRecordOpen(false);
      queryClient.invalidateQueries({ queryKey: [`/api/attendance/date/${selectedDate}`] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to save attendance record. Please try again.",
        variant: "destructive",
      });
      console.error("Error saving attendance:", error);
    },
  });
  
  // Initial form values for manual attendance
  const [manualAttendanceForm, setManualAttendanceForm] = useState({
    employeeId: "",
    date: selectedDate,
    checkIn: "",
    checkOut: "",
    status: "present",
    location: "Main Office",
    notes: "",
    clockMethod: "manual"
  });
  
  const handleAttendanceFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setManualAttendanceForm({
      ...manualAttendanceForm,
      [name]: value
    });
  };
  
  const handleAttendanceStatusChange = (value: string) => {
    setManualAttendanceForm({
      ...manualAttendanceForm,
      status: value
    });
  };
  
  const handleSubmitManualAttendance = (e: React.FormEvent) => {
    e.preventDefault();
    recordAttendanceMutation.mutate({...manualAttendanceForm,
      checkIn:manualAttendanceForm.checkIn ? new Date(manualAttendanceForm.date+'T'+manualAttendanceForm.checkIn).toISOString():'',
      checkOut:manualAttendanceForm.checkOut ? new Date(manualAttendanceForm.date+'T'+manualAttendanceForm.checkOut).toISOString():''});
  };
  
  // Employee query for dropdown
  const { data: employees } = useQuery<ApiEmployee[]>({
    queryKey: ['/api/employees'],
    staleTime: 1000 * 60 * 5 // 5 minutes
  });

  // Calculate summary stats
  const getAttendanceSummary = () => {
    if (!attendanceData) return { present: 0, absent: 0, late: 0, onLeave: 0 };
    
    const summary = {
      present: 0,
      absent: 0,
      late: 0,
      onLeave: 0
    };
    
    attendanceData.forEach((record: any) => {
      switch (record.status) {
        case 'present':
          summary.present++;
          break;
        case 'absent':
          summary.absent++;
          break;
        case 'late':
          summary.late++;
          break;
        case 'on_leave':
          summary.onLeave++;
          break;
      }
    });
    
    return summary;
  };
  
  const summary = getAttendanceSummary();

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xl font-semibold">Daily Attendance Records</CardTitle>
          <Dialog open={isManualRecordOpen} onOpenChange={setIsManualRecordOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <ClipboardList className="h-4 w-4 mr-2" /> Record Attendance
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Record Manual Attendance</DialogTitle>
                <DialogDescription>
                  Enter the attendance details for an employee.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmitManualAttendance}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="employeeId" className="text-right">
                      Employee
                    </Label>
                    <div className="col-span-3">
                      <Select 
                        name="employeeId" 
                        value={manualAttendanceForm.employeeId} 
                        onValueChange={(value) => setManualAttendanceForm({...manualAttendanceForm, employeeId: value})}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select an employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees?.map((employee: any) => (
                            <SelectItem key={employee.id} value={employee.id.toString()}>
                              {employee.firstName} {employee.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="date" className="text-right">
                      Date
                    </Label>
                    <Input
                      id="date"
                      name="date"
                      type="date"
                      value={manualAttendanceForm.date}
                      onChange={handleAttendanceFormChange}
                      className="col-span-3"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="status" className="text-right">
                      Status
                    </Label>
                    <div className="col-span-3">
                      <Select 
                        name="status" 
                        value={manualAttendanceForm.status} 
                        onValueChange={handleAttendanceStatusChange}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="present">Present</SelectItem>
                          <SelectItem value="late">Late</SelectItem>
                          <SelectItem value="absent">Absent</SelectItem>
                          <SelectItem value="on_leave">On Leave</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="checkIn" className="text-right">
                      Check In
                    </Label>
                    <Input
                      id="checkIn"
                      name="checkIn"
                      type="time"
                      value={manualAttendanceForm.checkIn}
                      onChange={handleAttendanceFormChange}
                      className="col-span-3"
                      required={manualAttendanceForm.status === 'present' || manualAttendanceForm.status === 'late'}
                      disabled={manualAttendanceForm.status === 'absent' || manualAttendanceForm.status === 'on_leave'}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="checkOut" className="text-right">
                      Check Out
                    </Label>
                    <Input
                      id="checkOut"
                      name="checkOut"
                      type="time"
                      value={manualAttendanceForm.checkOut}
                      onChange={handleAttendanceFormChange}
                      className="col-span-3"
                      disabled={manualAttendanceForm.status === 'absent' || manualAttendanceForm.status === 'on_leave'}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="location" className="text-right">
                      Location
                    </Label>
                    <Input
                      id="location"
                      name="location"
                      value={manualAttendanceForm.location}
                      onChange={handleAttendanceFormChange}
                      className="col-span-3"
                      disabled={manualAttendanceForm.status === 'absent' || manualAttendanceForm.status === 'on_leave'}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="notes" className="text-right">
                      Notes
                    </Label>
                    <Input
                      id="notes"
                      name="notes"
                      value={manualAttendanceForm.notes}
                      onChange={handleAttendanceFormChange}
                      className="col-span-3"
                      placeholder="Additional notes (optional)"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={recordAttendanceMutation.isPending}>
                    {recordAttendanceMutation.isPending ? "Saving..." : "Save Record"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:items-center sm:justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div>
                <label className="text-sm text-neutral-500 mb-1 block">Date</label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-40"
                  />
                  <Button variant="outline" onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])} size="sm">
                    Today
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="px-4 py-2 bg-green-500/10 rounded-md text-center">
                <p className="text-xs text-neutral-500">Present</p>
                <p className="font-semibold text-green-600">{summary.present}</p>
              </div>
              <div className="px-4 py-2 bg-red-500/10 rounded-md text-center">
                <p className="text-xs text-neutral-500">Absent</p>
                <p className="font-semibold text-red-600">{summary.absent}</p>
              </div>
              <div className="px-4 py-2 bg-yellow-500/10 rounded-md text-center">
                <p className="text-xs text-neutral-500">Late</p>
                <p className="font-semibold text-yellow-600">{summary.late}</p>
              </div>
              <div className="px-4 py-2 bg-blue-500/10 rounded-md text-center">
                <p className="text-xs text-neutral-500">On Leave</p>
                <p className="font-semibold text-blue-600">{summary.onLeave}</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Check In</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Check Out</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Location</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                      Loading attendance records...
                    </td>
                  </tr>
                ) : attendanceData?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                      No attendance records found for {selectedDate}
                    </td>
                  </tr>
                ) : (
                  attendanceData?.map((record: any) => (
                    <tr key={record.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-8 w-8">
                            <div className="h-8 w-8 rounded-full bg-neutral-200 flex items-center justify-center">
                              <UserRound className="h-4 w-4 text-neutral-600" />
                            </div>
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-neutral-900">
                              {employees?.find((e: any) => e.id === record.employeeId)?.firstName} {employees?.find((e: any) => e.id === record.employeeId)?.lastName}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-800">
                        {employees?.find((e: any) => e.id === record.employeeId)?.department || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-800">
                        {record.checkIn ? new Date(`1970-01-01T${record.checkIn}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-800">
                        {record.checkOut ? new Date(`1970-01-01T${record.checkOut}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge className={`
                          ${record.status === 'present' ? 'bg-green-500 hover:bg-green-500/80' : ''}
                          ${record.status === 'absent' ? 'bg-red-500 hover:bg-red-500/80' : ''}
                          ${record.status === 'late' ? 'bg-yellow-500 hover:bg-yellow-500/80' : ''}
                          ${record.status === 'on_leave' ? 'bg-blue-500 hover:bg-blue-500/80' : ''}
                        `}>
                          {record.status.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-800">
                        {record.location || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// Clock In/Out Component
function ClockInOut() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isClocking, setIsClocking] = useState(false);
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [clockingAction, setClockingAction] = useState<'in' | 'out' | 'break_start' | 'break_end' | null>(null);
  const [notes, setNotes] = useState('');
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Get today's attendance record for current user
  const { data: todayAttendance, isLoading } = useQuery<ApiAttendance | null>({
    queryKey: ['/api/attendance/today'],
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Get employee profile for current user
  const { user: currentUser } = useAuth();

  // Provide default values to prevent TypeScript errors
  const attendanceData = todayAttendance || {
    checkIn: null,
    checkOut: null,
    breakStartTime: null,
    breakEndTime: null,
    breakDurationMinutes: 0,
    location: null,
    notes: null
  };

  const userData = currentUser || { firstName: 'Employee', lastName: '' };

  // Get current clock status for dynamic UI
  const isCurrentlyClockedIn = attendanceData.checkIn && !attendanceData.checkOut;
  const isCurrentlyOnBreak = attendanceData.breakStartTime && !attendanceData.breakEndTime;
  const hasCompletedShift = attendanceData.checkIn && attendanceData.checkOut;

  // Clock in/out mutation
  const clockMutation = useMutation({
    mutationFn: async (action: {type: 'in' | 'out' | 'break_start' | 'break_end', location?: string, notes?: string}) => {
      // Map action types to correct API endpoints
      const endpoint = action.type === 'in' ? '/api/attendance/clock-in' :
                      action.type === 'out' ? '/api/attendance/clock-out' :
                      action.type === 'break_start' ? '/api/attendance/clock-break_start' :
                      '/api/attendance/clock-break_end';
      
      console.log('Clocking action:', action.type, 'to endpoint:', endpoint);
      
      const response = await apiRequest({
        url: endpoint,
        method: 'POST',
        body: JSON.stringify({
          location: action.location,
          notes: action.notes
        }),
      });
      
      return response.json();
    },
    onSuccess: (data, variables) => {
      const actionText = variables.type === 'break_start' ? 'started break' : 
                        variables.type === 'break_end' ? 'ended break' : 
                        `clocked ${variables.type}`;
      toast({
        title: "Success",
        description: `Successfully ${actionText}!`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/attendance/today'] });
      setIsClocking(false);
      setIsNotesModalOpen(false);
      setNotes('');
      setClockingAction(null);
      if (variables.type === 'break_start') setIsOnBreak(true);
      if (variables.type === 'break_end') setIsOnBreak(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to record time. Please try again.",
        variant: "destructive",
      });
      setIsClocking(false);
      setIsNotesModalOpen(false);
      setClockingAction(null);
    },
  });

  // Get current location
  const getCurrentLocation = () => {
    return new Promise<{lat: number, lng: number}>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  };

  const handleClockAction = async (action: 'in' | 'out' | 'break_start' | 'break_end', skipNotes = false) => {
    if (!skipNotes && (action === 'out' || action === 'break_start')) {
      setClockingAction(action);
      setIsNotesModalOpen(true);
      return;
    }

    setIsClocking(true);
    setClockingAction(action);
    let coordinates: {lat:number;lng:number}|undefined;
    try{coordinates=await getCurrentLocation();setLocation(coordinates);}catch{/* Location is optional. */}
    try{await clockMutation.mutateAsync({type:action,location:coordinates?`${coordinates.lat},${coordinates.lng}`:undefined,notes:notes||undefined});}catch{/* Mutation handler displays the error; never submit a second clock action. */}
  };

  const confirmClockAction = () => {
    if (clockingAction) {
      handleClockAction(clockingAction, true);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const calculateHours = (checkIn: string, checkOut?: string | null) => {
    if (!checkOut) {
      // Calculate hours worked so far if clocked in
      const start = new Date(checkIn);
      const now = new Date();
      const diffMs = now.getTime() - start.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `${hours}h ${minutes}m (ongoing)`;
    }
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end.getTime() - start.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const calculateBreakTime = (breakStart?: string | null, breakEnd?: string | null) => {
    if (!breakStart) return '0m';
    const start = new Date(breakStart);
    const end = breakEnd ? new Date(breakEnd) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const minutes = Math.floor(diffMs / (1000 * 60));
    return breakEnd ? `${minutes}m` : `${minutes}m (ongoing)`;
  };

  const isLateClockIn = (checkIn: string) => {
    const clockInTime = new Date(`1970-01-01T${checkIn}`);
    const standardStart = new Date('1970-01-01T09:00:00'); // 9 AM standard
    return clockInTime > standardStart;
  };

  const calculateOvertime = (totalMinutes: number) => {
    const standardWorkMinutes = 8 * 60; // 8 hours
    const overtime = Math.max(0, totalMinutes - standardWorkMinutes);
    const hours = Math.floor(overtime / 60);
    const minutes = overtime % 60;
    return overtime > 0 ? `${hours}h ${minutes}m` : '0h 0m';
  };

  return (
    <div className="space-y-6">
      {/* Current Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Today's Time Clock - {userData.firstName || 'Employee'}
          </CardTitle>
          <CardDescription className="flex items-center justify-between">
            <span>
              {currentTime.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </span>
            <span className="font-mono text-lg">
              {currentTime.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
              })}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div>Loading today's attendance...</div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Status Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-blue-600" />
                    <span className="font-medium">Check In</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-600 mt-2">
                    {attendanceData.checkIn ? formatTime(attendanceData.checkIn) : '--:--'}
                  </p>
                  {attendanceData.checkIn && isLateClockIn(attendanceData.checkIn) && (
                    <Badge variant="outline" className="mt-1 text-xs text-yellow-600 border-yellow-600">
                      Late
                    </Badge>
                  )}
                </div>
                <div className="p-4 bg-orange-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-orange-600" />
                    <span className="font-medium">Check Out</span>
                  </div>
                  <p className="text-2xl font-bold text-orange-600 mt-2">
                    {attendanceData.checkOut ? formatTime(attendanceData.checkOut) : '--:--'}
                  </p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5 text-green-600" />
                    <span className="font-medium">Calculated Hours</span>
                  </div>
                  <p className="text-xl font-bold text-green-600 mt-2">
                    {attendanceData.checkIn ? 
                      calculateHours(attendanceData.checkIn, attendanceData.checkOut) : '0h 0m'}
                  </p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Timer className="h-5 w-5 text-purple-600" />
                    <span className="font-medium">Break Time</span>
                  </div>
                  <p className="text-xl font-bold text-purple-600 mt-2">
                    {calculateBreakTime(attendanceData.breakStartTime, attendanceData.breakEndTime)}
                  </p>
                  {attendanceData.breakStartTime && !attendanceData.breakEndTime && (
                    <Badge variant="outline" className="mt-1 text-xs text-orange-600 border-orange-600">
                      On Break
                    </Badge>
                  )}
                </div>
              </div>

              {/* Overtime & Late Indicators */}
              {attendanceData.checkIn && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <span className="font-medium text-sm">Overtime</span>
                    </div>
                    <p className="text-lg font-semibold text-yellow-700">
                      {(() => {
                        if (!attendanceData.checkOut) return 'TBD';
                        const start = new Date(attendanceData.checkIn);
                        const end = new Date(attendanceData.checkOut);
                        const totalMinutes = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
                        return calculateOvertime(totalMinutes);
                      })()}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-gray-600" />
                      <span className="font-medium text-sm">Location</span>
                    </div>
                    <p className="text-sm text-gray-700">
                      {attendanceData.location || 'Not recorded'}
                    </p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-center gap-3">
                {!attendanceData.checkIn ? (
                  <Button 
                    onClick={async () => {
                      setIsClocking(true);
                      setClockingAction('in');
                      try {
                        // Try to get location but don't fail if unavailable
                        let locationStr = null;
                        try {
                          const loc = await getCurrentLocation();
                          locationStr = `${loc.lat},${loc.lng}`;
                        } catch (e) {
                          console.log('Location unavailable');
                        }
                        
                        // Use the mutation to clock in
                        await clockMutation.mutateAsync({
                          type: 'in',
                          location: locationStr ?? undefined,
                          notes: undefined
                        });
                      } catch (error) {
                        console.error('Clock in failed:', error);
                        setIsClocking(false);
                        setClockingAction(null);
                      }
                    }}
                    disabled={isClocking || clockMutation.isPending}
                    size="lg"
                    className="bg-green-600 hover:bg-green-700 text-white px-8"
                  >
                    {isClocking && clockingAction === 'in' ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                        Clocking In...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-5 w-5 mr-2" />
                        Clock In
                      </>
                    )}
                  </Button>
                ) : !attendanceData.checkOut ? (
                  <div className="flex gap-3">
                    {!attendanceData.breakStartTime || attendanceData.breakEndTime ? (
                      <Button 
                        onClick={() => handleClockAction('break_start')}
                        disabled={isClocking || clockMutation.isPending}
                        size="lg"
                        variant="outline"
                        className="border-blue-600 text-blue-600 hover:bg-blue-50 px-6"
                      >
                        {isClocking && clockingAction === 'break_start' ? (
                          <>
                            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2"></div>
                            Starting Break...
                          </>
                        ) : (
                          <>
                            <Timer className="h-5 w-5 mr-2" />
                            Start Break
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button 
                        onClick={() => handleClockAction('break_end')}
                        disabled={isClocking || clockMutation.isPending}
                        size="lg"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                      >
                        {isClocking && clockingAction === 'break_end' ? (
                          <>
                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                            Ending Break...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-5 w-5 mr-2" />
                            End Break
                          </>
                        )}
                      </Button>
                    )}
                    
                    <Button 
                      onClick={() => handleClockAction('out')}
                      disabled={isClocking || clockMutation.isPending}
                      size="lg"
                      variant="outline"
                      className="border-red-600 text-red-600 hover:bg-red-50 px-8"
                    >
                      {isClocking && clockingAction === 'out' ? (
                        <>
                          <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full mr-2"></div>
                          Clocking Out...
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-5 w-5 mr-2" />
                          Clock Out
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <Badge variant="outline" className="text-green-600 border-green-600 px-6 py-3 text-sm">
                      ✓ Completed for today
                    </Badge>
                    <div className="mt-3 grid grid-cols-2 gap-4 text-sm text-gray-600">
                      <div>
                        <strong>Total work time:</strong><br />
                        {calculateHours(attendanceData.checkIn, attendanceData.checkOut)}
                      </div>
                      <div>
                        <strong>Break time:</strong><br />
                        {calculateBreakTime(attendanceData.breakStartTime, attendanceData.breakEndTime)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Location Status */}
              {location && (
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                  <MapPin className="h-4 w-4" />
                  <span>Location captured: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes Modal */}
      <Dialog open={isNotesModalOpen} onOpenChange={setIsNotesModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {clockingAction === 'out' ? 'Clock Out' : 'Start Break'}
            </DialogTitle>
            <DialogDescription>
              {clockingAction === 'out' 
                ? 'Add any notes about your work day (optional)'
                : 'Add any notes about your break (optional)'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              className="w-full mt-2 p-2 border border-gray-300 rounded-md resize-none"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={clockingAction === 'out' 
                ? 'Completed tasks, issues encountered, etc...'
                : 'Lunch break, meeting, personal time, etc...'
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNotesModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmClockAction} disabled={isClocking || clockMutation.isPending}>
              {isClocking ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                  Processing...
                </>
              ) : (
                `Confirm ${clockingAction === 'out' ? 'Clock Out' : 'Start Break'}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card 
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => {
            toast({
              title: "QR Code Scanner",
              description: "QR code scanning feature coming soon!",
            });
          }}
        >
          <CardContent className="p-4 text-center">
            <QrCode className="h-8 w-8 mx-auto mb-2 text-blue-600" />
            <h3 className="font-medium">QR Code</h3>
            <p className="text-xs text-gray-500">Not connected</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => {
            toast({
              title: "Biometric Scanner",
              description: "Fingerprint scanning feature coming soon!",
            });
          }}
        >
          <CardContent className="p-4 text-center">
            <Fingerprint className="h-8 w-8 mx-auto mb-2 text-green-600" />
            <h3 className="font-medium">Biometric</h3>
            <p className="text-xs text-gray-500">Not connected</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if (isMobile) {
              // On mobile, act as a quick clock action
              if (!attendanceData.checkIn) {
                handleClockAction('in', true); // Skip notes for quick mobile action
              } else if (!attendanceData.checkOut) {
                handleClockAction('out');
              }
            } else {
              toast({
                title: "Mobile App",
                description: "Use this feature on a mobile device for quick clock actions!",
              });
            }
          }}
        >
          <CardContent className="p-4 text-center">
            <Smartphone className="h-8 w-8 mx-auto mb-2 text-purple-600" />
            <h3 className="font-medium">Mobile App</h3>
            <p className="text-xs text-gray-500">Use mobile device</p>
          </CardContent>
        </Card>
        <Dialog>
          <DialogTrigger asChild>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-4 text-center">
                <UserRound className="h-8 w-8 mx-auto mb-2 text-orange-600" />
                <h3 className="font-medium">Manual Entry</h3>
                <p className="text-xs text-gray-500">HR manual recording</p>
              </CardContent>
            </Card>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Manual Clock Entry</DialogTitle>
              <DialogDescription>
                Enter attendance manually (HR use only)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Button 
                  onClick={async () => {
                    if (!attendanceData.checkIn) {
                      await handleClockAction('in', true);
                      // Force a refresh after clock action
                      queryClient.invalidateQueries({ queryKey: ['/api/attendance/today'] });
                    } else {
                      toast({title: "Already clocked in", description: "You're already clocked in for today."});
                    }
                  }}
                  disabled={!!attendanceData.checkIn}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  Manual Clock In
                </Button>
                <Button 
                  onClick={async () => {
                    if (attendanceData.checkIn && !attendanceData.checkOut) {
                      await handleClockAction('out');
                      // Force a refresh after clock action
                      queryClient.invalidateQueries({ queryKey: ['/api/attendance/today'] });
                    } else {
                      toast({title: "Cannot clock out", description: "Please clock in first or you're already clocked out."});
                    }
                  }}
                  disabled={!attendanceData.checkIn || !!attendanceData.checkOut}
                  variant="outline"
                  className="border-red-600 text-red-600 hover:bg-red-50"
                >
                  Manual Clock Out
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Button 
                  onClick={() => attendanceData.checkIn && !attendanceData.checkOut && (!attendanceData.breakStartTime || attendanceData.breakEndTime) ? handleClockAction('break_start') : toast({title: "Cannot start break", description: "Please clock in first or end current break."})}
                  disabled={!attendanceData.checkIn || !!attendanceData.checkOut || !!(attendanceData.breakStartTime && !attendanceData.breakEndTime)}
                  variant="outline"
                  className="border-blue-600 text-blue-600 hover:bg-blue-50"
                >
                  Start Break
                </Button>
                <Button 
                  onClick={() => attendanceData.breakStartTime && !attendanceData.breakEndTime ? handleClockAction('break_end', true) : toast({title: "Cannot end break", description: "No active break to end."})}
                  disabled={!attendanceData.breakStartTime || !!attendanceData.breakEndTime}
                  variant="outline"
                  className="border-purple-600 text-purple-600 hover:bg-purple-50"
                >
                  End Break
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// Shift Scheduling Component
function ShiftScheduling() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isCreateShiftOpen, setIsCreateShiftOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch shift schedules
  const { data: shifts, isLoading } = useQuery<ApiShift[]>({
    queryKey: [`/api/shift-schedules?date=${selectedDate}`],
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch employees for shift assignment
  const { data: employees } = useQuery<ApiEmployee[]>({
    queryKey: ['/api/employees'],
    staleTime: 1000 * 60 * 10, // 10 minutes
  });

  // Create shift mutation
  const createShiftMutation = useMutation({
    mutationFn: (shiftData: any) => apiRequest('/api/shift-schedules', {
      method: 'POST',
      body: JSON.stringify(shiftData),
    }),
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Shift schedule created successfully.",
      });
      setIsCreateShiftOpen(false);
      queryClient.invalidateQueries({ queryKey: [`/api/shift-schedules?date=${selectedDate}`] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create shift schedule.",
        variant: "destructive",
      });
    },
  });

  const [newShift, setNewShift] = useState({
    employeeId: '',
    shiftName: '',
    date: selectedDate,
    startTime: '',
    endTime: '',
    breakDuration: 60,
    location: 'Main Office',
    assignedRole: ''
  });

  const handleCreateShift = (e: React.FormEvent) => {
    e.preventDefault();
    createShiftMutation.mutate(newShift);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Shift Scheduling</CardTitle>
            <CardDescription>Manage employee work shifts and schedules</CardDescription>
          </div>
          <Dialog open={isCreateShiftOpen} onOpenChange={setIsCreateShiftOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Shift
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Shift</DialogTitle>
                <DialogDescription>
                  Set up a new shift schedule for an employee.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateShift}>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="shiftEmployee">Employee</Label>
                    <Select 
                      value={newShift.employeeId} 
                      onValueChange={(value) => setNewShift({...newShift, employeeId: value})}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees?.map((employee: any) => (
                          <SelectItem key={employee.id} value={employee.id.toString()}>
                            {employee.firstName} {employee.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="shiftName">Shift Name</Label>
                    <Input
                      id="shiftName"
                      value={newShift.shiftName}
                      onChange={(e) => setNewShift({...newShift, shiftName: e.target.value})}
                      placeholder="e.g., Morning Shift"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="shiftDate">Date</Label>
                    <Input
                      id="shiftDate"
                      type="date"
                      value={newShift.date}
                      onChange={(e) => setNewShift({...newShift, date: e.target.value})}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="startTime">Start Time</Label>
                      <Input
                        id="startTime"
                        type="time"
                        value={newShift.startTime}
                        onChange={(e) => setNewShift({...newShift, startTime: e.target.value})}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="endTime">End Time</Label>
                      <Input
                        id="endTime"
                        type="time"
                        value={newShift.endTime}
                        onChange={(e) => setNewShift({...newShift, endTime: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="breakDuration">Break Duration (minutes)</Label>
                    <Input
                      id="breakDuration"
                      type="number"
                      value={newShift.breakDuration}
                      onChange={(e) => setNewShift({...newShift, breakDuration: parseInt(e.target.value)})}
                      min="0"
                      max="120"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={newShift.location}
                      onChange={(e) => setNewShift({...newShift, location: e.target.value})}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="assignedRole">Assigned Role</Label>
                    <Input
                      id="assignedRole"
                      value={newShift.assignedRole}
                      onChange={(e) => setNewShift({...newShift, assignedRole: e.target.value})}
                      placeholder="e.g., Cashier, Security Guard"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createShiftMutation.isPending}>
                    {createShiftMutation.isPending ? "Creating..." : "Create Shift"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-6">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-40"
              />
            </div>
            <Button variant="outline" onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}>
              Today
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div>Loading shifts...</div>
            </div>
          ) : shifts?.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No shifts scheduled</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by creating a shift schedule.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {shifts?.map((shift: any) => (
                <Card key={shift.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className="font-medium">{shift.shiftName}</h3>
                        <p className="text-sm text-gray-600">
                          Employee: {employees?.find((e: any) => e.id === shift.employeeId)?.firstName} {employees?.find((e: any) => e.id === shift.employeeId)?.lastName}
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {shift.startTime} - {shift.endTime}
                          </span>
                          <span className="flex items-center gap-1">
                            <Building2 className="h-4 w-4" />
                            {shift.location}
                          </span>
                          {shift.assignedRole && (
                            <Badge variant="outline">{shift.assignedRole}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Geofencing Management Component
function GeofencingManagement() {
  const [isCreateGeofenceOpen, setIsCreateGeofenceOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch geofences
  const { data: geofences, isLoading } = useQuery<ApiGeofence[]>({
    queryKey: ['/api/geofences'],
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Create geofence mutation
  const createGeofenceMutation = useMutation({
    mutationFn: (geofenceData: any) => apiRequest('/api/geofences', {
      method: 'POST',
      body: JSON.stringify(geofenceData),
    }),
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Geofence created successfully.",
      });
      setIsCreateGeofenceOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/api/geofences'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create geofence.",
        variant: "destructive",
      });
    },
  });

  const [newGeofence, setNewGeofence] = useState({
    geofenceName: '',
    latitude: '',
    longitude: '',
    radius: 100,
    startDate: '',
    endDate: '',
    associatedLocations: ['']
  });

  const handleCreateGeofence = (e: React.FormEvent) => {
    e.preventDefault();
    createGeofenceMutation.mutate({
      ...newGeofence,
      geofenceId: `geo_${Date.now()}`,
      associatedLocations: newGeofence.associatedLocations.filter(loc => loc.trim() !== '')
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Geofencing Management</CardTitle>
            <CardDescription>Set up location-based attendance tracking</CardDescription>
          </div>
          <Dialog open={isCreateGeofenceOpen} onOpenChange={setIsCreateGeofenceOpen}>
            <DialogTrigger asChild>
              <Button>
                <Map className="h-4 w-4 mr-2" />
                Create Geofence
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Geofence</DialogTitle>
                <DialogDescription>
                  Define a geographic boundary for attendance tracking.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateGeofence}>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="geofenceName">Location Name</Label>
                    <Input
                      id="geofenceName"
                      value={newGeofence.geofenceName}
                      onChange={(e) => setNewGeofence({...newGeofence, geofenceName: e.target.value})}
                      placeholder="e.g., Main Office, Warehouse"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="latitude">Latitude</Label>
                      <Input
                        id="latitude"
                        type="number"
                        step="any"
                        value={newGeofence.latitude}
                        onChange={(e) => setNewGeofence({...newGeofence, latitude: e.target.value})}
                        placeholder="25.276987"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="longitude">Longitude</Label>
                      <Input
                        id="longitude"
                        type="number"
                        step="any"
                        value={newGeofence.longitude}
                        onChange={(e) => setNewGeofence({...newGeofence, longitude: e.target.value})}
                        placeholder="51.520008"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="radius">Radius (meters)</Label>
                    <Input
                      id="radius"
                      type="number"
                      value={newGeofence.radius}
                      onChange={(e) => setNewGeofence({...newGeofence, radius: parseInt(e.target.value)})}
                      min="10"
                      max="1000"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="startDate">Start Date</Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={newGeofence.startDate}
                        onChange={(e) => setNewGeofence({...newGeofence, startDate: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label htmlFor="endDate">End Date</Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={newGeofence.endDate}
                        onChange={(e) => setNewGeofence({...newGeofence, endDate: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createGeofenceMutation.isPending}>
                    {createGeofenceMutation.isPending ? "Creating..." : "Create Geofence"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div>Loading geofences...</div>
            </div>
          ) : geofences?.length === 0 ? (
            <div className="text-center py-8">
              <Map className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No geofences configured</h3>
              <p className="mt-1 text-sm text-gray-500">Set up location boundaries for attendance tracking.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {geofences?.map((geofence: any) => (
                <Card key={geofence.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">{geofence.geofenceName}</h3>
                        <Badge variant="outline">Active</Badge>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p><span className="font-medium">Location:</span> {geofence.latitude}, {geofence.longitude}</p>
                        <p><span className="font-medium">Radius:</span> {geofence.radius}m</p>
                        {geofence.startDate && (
                          <p><span className="font-medium">Active:</span> {geofence.startDate} - {geofence.endDate || 'Ongoing'}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <Button variant="outline" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Attendance Reports Component
function AttendanceReports() {
  const [reportType, setReportType] = useState('daily');
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  const { data: reportData, isLoading } = useQuery<{summary:{present:number;absent:number;late:number;onLeave:number};details:{employeeName:string;department:string;date:string;checkIn:string|null;checkOut:string|null;totalHours:string;status:string}[]}>({
    queryKey: [`/api/attendance/reports/${reportType}`, dateRange],
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  return (
    <div className="space-y-6">
      {/* Report Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Attendance Reports</CardTitle>
          <CardDescription>Generate and analyze attendance reports</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily Summary</SelectItem>
                  <SelectItem value="weekly">Weekly Summary</SelectItem>
                  <SelectItem value="monthly">Monthly Summary</SelectItem>
                  <SelectItem value="employee">By Employee</SelectItem>
                  <SelectItem value="department">By Department</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="w-40"
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="w-40"
              />
            </div>
            <Button className="mt-6">
              <BarChart4 className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Results */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Present</p>
                <p className="text-2xl font-bold text-green-600">
                  {reportData?.summary?.present || 0}
                </p>
              </div>
              <Users className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Absent</p>
                <p className="text-2xl font-bold text-red-600">
                  {reportData?.summary?.absent || 0}
                </p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Late Arrivals</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {reportData?.summary?.late || 0}
                </p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">On Leave</p>
                <p className="text-2xl font-bold text-blue-600">
                  {reportData?.summary?.onLeave || 0}
                </p>
              </div>
              <CalendarIcon className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Report Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Report</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div>Generating report...</div>
            </div>
          ) : reportData?.details?.length === 0 ? (
            <div className="text-center py-8">
              <BarChart4 className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No data available</h3>
              <p className="mt-1 text-sm text-gray-500">No attendance data found for the selected period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Check In
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Check Out
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hours
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportData?.details?.map((record: any, index: number) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {record.employeeName}
                        </div>
                        <div className="text-sm text-gray-500">{record.department}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {record.date}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {record.checkIn || '--'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {record.checkOut || '--'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {record.totalHours || '0:00'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge className={getStatusColor(record.status)}>
                          {record.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Helper function to get status color
function getStatusColor(status: string) {
  switch (status) {
    case 'present':
      return 'bg-green-100 text-green-800';
    case 'absent':
      return 'bg-red-100 text-red-800';
    case 'late':
      return 'bg-yellow-100 text-yellow-800';
    case 'on_leave':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}
