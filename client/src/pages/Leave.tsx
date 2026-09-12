import { leaveDays, type CompanySettings } from '@shared/settings';
import type { ApiEmployee } from '@/lib/api-types';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatDate, getStatusClass } from "@/lib/utils";
import { useState } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogTrigger 
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

// Types for leave data
interface LeaveType {
  id: number;
  name: string;
  category: string;
  accrualMethod: string;
  maxDays: number;
  carryOver: boolean;
  allowHalfDay: boolean;
}

interface LeaveRequest {
  id: number;
  employeeId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  halfDayOption?: string | null;
  reason: string;
  status: string;
  supportingDocuments?: Array<{ id: number, fileName: string, fileUrl: string }>;
  approvals?: Array<{ id: number, approverId: number, approverName: string, status: string, note?: string }>;
  createdAt: string;
  updatedAt: string;
}

interface LeaveWithEmployee extends LeaveRequest {
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    department: string;
    position: string;
  };
  leaveType: {
    id: number;
    name: string;
  };
}

// Form schema
const leaveRequestSchema = z.object({
  employeeId: z.number().min(1, "Employee is required"),
  leaveTypeId: z.number().min(1, "Leave type is required"),
  startDate: z.date({
    required_error: "Start date is required",
  }),
  endDate: z.date({
    required_error: "End date is required",
  }).refine(data => data >= new Date(), {
    message: "End date must be today or in the future",
  }),
  halfDayOption: z.string().optional().nullable(),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

type LeaveRequestFormValues = z.infer<typeof leaveRequestSchema>;

export default function Leave() {
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedLeave, setSelectedLeave] = useState<LeaveWithEmployee | null>(null);
  const [openRequestDialog, setOpenRequestDialog] = useState(false);
  const [openViewDialog, setOpenViewDialog] = useState(false);
  const { toast } = useToast();
  
  // Get current user from auth
  const { user: currentUser } = useAuth();
  
  const userRole = currentUser?.role || 'employee';
  const { data: policy } = useQuery<CompanySettings>({queryKey:['/api/settings/company']});
  const { data: selfEmployee } = useQuery<ApiEmployee>({queryKey:['/api/employee/profile']});
  
  // Fetch all leave types
  const { data: leaveTypes, isLoading: loadingLeaveTypes } = useQuery<LeaveType[]>({
    queryKey: ['/api/leave-types'],
  });
  
  // Fetch leave requests based on active tab
  const { data: leaveRequests, isLoading, error } = useQuery<LeaveWithEmployee[]>({
    queryKey: activeTab === "all" ? ['/api/leaves'] : [`/api/leaves/status/${activeTab}`],
    staleTime: 1000 * 60, // 1 minute
  });
  
  // Form setup
  const form = useForm<LeaveRequestFormValues>({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: {
      employeeId: 1, // Will be updated when we get employee data
      startDate: new Date(),
      endDate: new Date(),
      reason: "",
    },
  });
  
  // Calculate total leave days
  const calculateDays = (startDate: Date, endDate: Date) => {
    const oneDay = 24 * 60 * 60 * 1000;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.round(Math.abs((end.getTime() - start.getTime()) / oneDay)) + 1;
    
    // Exclude weekends (assuming Saturday and Sunday are weekends)
    let totalDays = 0;
    for (let i = 0; i < diffDays; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const dayOfWeek = day.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Sunday, 6 = Saturday
        totalDays++;
      }
    }
    
    return totalDays;
  };
  
  // Mutations
  const createLeaveMutation = useMutation({
    mutationFn: async (data: LeaveRequestFormValues) => {
      // Find the selected leave type
      const selectedLeaveType = leaveTypes?.find(lt => lt.id === data.leaveTypeId);
      
      // Calculate total days
      const totalDays = leaveDays(data.startDate.toISOString().slice(0,10),data.endDate.toISOString().slice(0,10),policy?.weekendDays || [0,6]);
      
      // Transform the data to match backend schema
      const leaveData = {
        employeeId: data.employeeId,
        leaveType: selectedLeaveType?.name || 'Annual Leave',
        startDate: data.startDate.toISOString().split('T')[0],
        endDate: data.endDate.toISOString().split('T')[0],
        totalDays: totalDays,
        reason: data.reason
      };
      
      const response = await apiRequest({
        url: '/api/leaves',
        method: 'POST',
        body: JSON.stringify(leaveData)
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leaves'] });
      toast({
        title: "Leave request submitted",
        description: "Your leave request has been submitted successfully.",
      });
      setOpenRequestDialog(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to submit leave request. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  const updateLeaveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number, status: string }) => {
      const response = await apiRequest({
        url: `/api/leaves/${id}/status`,
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leaves'] });
      toast({
        title: "Leave request updated",
        description: "The leave request has been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update leave request. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  // Handle form submission
  const onSubmit = (data: LeaveRequestFormValues) => {
    if(!selfEmployee){toast({title:'Employee profile required',description:'Ask HR to link your account to an employee record.',variant:'destructive'});return;}
    // Use the linked employee record, not the account ID
    const submitData = {
      ...data,
      employeeId: selfEmployee.id
    };
    createLeaveMutation.mutate(submitData);
  };
  
  // Handle approval/rejection
  const handleApprove = (id: number) => {
    updateLeaveMutation.mutate({ id, status: 'approved' });
  };

  const handleReject = (id: number) => {
    updateLeaveMutation.mutate({ id, status: 'rejected' });
  };

  // Calculate total days between start and end date
  const getTotalDays = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };
  
  // Filter leaves based on active tab
  const filteredLeaves = Array.isArray(leaveRequests) 
    ? leaveRequests.filter(leave => {
        if (activeTab === "all") return true;
        return leave.status === activeTab;
      }) 
    : [];
  
  // Handle view leave details
  const handleViewLeaveDetails = (leave: LeaveWithEmployee) => {
    setSelectedLeave(leave);
    setOpenViewDialog(true);
  };
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xl font-medium">Leave Management</CardTitle>
          <Button 
            className="bg-primary hover:bg-primary/90"
            onClick={() => setOpenRequestDialog(true)}
          >
            <i className="fas fa-plus mr-2"></i> Request Leave
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="pending" onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
              <TabsTrigger value="all">All Requests</TabsTrigger>
            </TabsList>
            
            <TabsContent value={activeTab} className="mt-0">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Department</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Leave Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Duration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Days</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Submitted</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-neutral-200">
                    {isLoading ? (
                      Array(5).fill(0).map((_, i) => (
                        <tr key={i}>
                          <td className="px-4 py-3"><Skeleton className="h-6 w-24" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-6 w-20" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-6 w-20" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-6 w-32" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-6 w-10" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-6 w-16" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-6 w-20" /></td>
                          <td className="px-4 py-3 text-right"><Skeleton className="h-6 w-24 ml-auto" /></td>
                        </tr>
                      ))
                    ) : error ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-3 text-sm text-center text-error">Error loading leave requests</td>
                      </tr>
                    ) : filteredLeaves.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-3 text-sm text-center text-neutral-500">No leave requests found</td>
                      </tr>
                    ) : (
                      filteredLeaves.map((leave) => (
                        <tr key={leave.id} className="hover:bg-neutral-50">
                          <td className="px-4 py-3 text-sm font-medium text-neutral-800">
                            {leave.employee.firstName} {leave.employee.lastName}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {leave.employee.department}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {leave.leaveType.name}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {formatDate(leave.startDate)} - {formatDate(leave.endDate)}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {getTotalDays(leave.startDate, leave.endDate)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <Badge variant={
                                leave.status === 'pending' ? 'outline' : 
                                leave.status === 'approved' ? 'secondary' : 'destructive'
                              } 
                              className={`capitalize ${
                                leave.status === 'approved' ? 'bg-green-100 text-green-800 hover:bg-green-200' : ''
                              }`}>
                              {leave.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {formatDate(leave.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            {leave.status === 'pending' && (userRole === 'admin' || userRole === 'hr') ? (
                              <div className="flex justify-end space-x-2">
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="text-green-500 border-green-500 hover:bg-green-50"
                                  onClick={() => handleApprove(leave.id)}
                                  disabled={updateLeaveMutation.isPending}
                                >
                                  Approve
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="text-red-500 border-red-500 hover:bg-red-50"
                                  onClick={() => handleReject(leave.id)}
                                  disabled={updateLeaveMutation.isPending}
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleViewLeaveDetails(leave)}
                              >
                                View Details
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">Leave Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full bg-neutral-50 rounded-lg flex items-center justify-center">
              <div className="text-center">
                <p className="text-neutral-500">Calendar view coming soon</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">Leave Balances</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingLeaveTypes ? (
              <div className="space-y-3">
                {Array(3).fill(0).map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                ))}
              </div>
            ) : !leaveTypes || leaveTypes.length === 0 ? (
              <p className="text-neutral-500 text-center">No leave types configured</p>
            ) : (
              <div className="space-y-3">
                {leaveTypes.map(type => (
                  <div key={type.id} className="flex justify-between items-center">
                    <div>
                      <span className="font-medium text-neutral-700">{type.name}</span>
                      <span className="ml-2 text-xs text-neutral-500">({type.category})</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">{Math.floor(Math.random() * type.maxDays)} / {type.maxDays} days</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Request Leave Dialog */}
      <Dialog open={openRequestDialog} onOpenChange={setOpenRequestDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Leave</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="leaveTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Leave Type</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      defaultValue={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select leave type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {leaveTypes?.map((type) => (
                          <SelectItem key={type.id} value={type.id.toString()}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Start Date</FormLabel>
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date < new Date()}
                        className="rounded-md border"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>End Date</FormLabel>
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date < form.getValues("startDate")}
                        className="rounded-md border"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Provide reason for leave request"
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="mt-2 text-sm text-neutral-500">
                {form.watch("startDate") && form.watch("endDate") && (
                  <p>
                    Total days: <span className="font-medium">{calculateDays(form.watch("startDate"), form.watch("endDate"))}</span>
                  </p>
                )}
              </div>
              
              <DialogFooter className="sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => setOpenRequestDialog(false)}
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createLeaveMutation.isPending}
                >
                  {createLeaveMutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* View Leave Details Dialog */}
      <Dialog open={openViewDialog} onOpenChange={setOpenViewDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave Request Details</DialogTitle>
          </DialogHeader>
          
          {selectedLeave && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-sm text-neutral-500">Employee</p>
                  <p className="font-medium">{selectedLeave.employee.firstName} {selectedLeave.employee.lastName}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Department</p>
                  <p className="font-medium">{selectedLeave.employee.department}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Leave Type</p>
                  <p className="font-medium">{selectedLeave.leaveType.name}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Status</p>
                  <Badge variant={
                    selectedLeave.status === 'pending' ? 'outline' : 
                    selectedLeave.status === 'approved' ? 'secondary' : 'destructive'
                  } 
                  className={`capitalize mt-1 ${
                    selectedLeave.status === 'approved' ? 'bg-green-100 text-green-800 hover:bg-green-200' : ''
                  }`}>
                    {selectedLeave.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Start Date</p>
                  <p className="font-medium">{formatDate(selectedLeave.startDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">End Date</p>
                  <p className="font-medium">{formatDate(selectedLeave.endDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Total Days</p>
                  <p className="font-medium">{getTotalDays(selectedLeave.startDate, selectedLeave.endDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Submitted On</p>
                  <p className="font-medium">{formatDate(selectedLeave.createdAt)}</p>
                </div>
              </div>
              
              <div>
                <p className="text-sm text-neutral-500">Reason</p>
                <p className="mt-1 p-2 bg-neutral-50 rounded-md">{selectedLeave.reason}</p>
              </div>
              
              {selectedLeave.supportingDocuments && selectedLeave.supportingDocuments.length > 0 && (
                <div>
                  <p className="text-sm text-neutral-500">Supporting Documents</p>
                  <div className="mt-1 space-y-1">
                    {selectedLeave.supportingDocuments.map(doc => (
                      <div key={doc.id} className="flex items-center">
                        <i className="far fa-file mr-2"></i>
                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {doc.fileName}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {currentUser?.role === 'manager' && selectedLeave.status === 'pending' && (
                <div className="flex space-x-2 justify-end">
                  <Button 
                    variant="outline" 
                    className="text-red-500 border-red-500 hover:bg-red-50"
                    onClick={() => {
                      handleReject(selectedLeave.id);
                      setOpenViewDialog(false);
                    }}
                    disabled={updateLeaveMutation.isPending}
                  >
                    Reject
                  </Button>
                  <Button 
                    variant="outline"
                    className="text-green-500 border-green-500 hover:bg-green-50"
                    onClick={() => {
                      handleApprove(selectedLeave.id);
                      setOpenViewDialog(false);
                    }}
                    disabled={updateLeaveMutation.isPending}
                  >
                    Approve
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
