import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { UserPlusIcon, UserMinusIcon, CheckCircleIcon, XCircleIcon } from "lucide-react";
import { Employee, EventRole, EventStaffAssignment } from "@shared/schema";

interface EventStaffRosterProps {
  eventId: number;
  onAssignmentsUpdate?: () => void;
}

export default function EventStaffRoster({ eventId, onAssignmentsUpdate }: EventStaffRosterProps) {
  const { toast } = useToast();
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  
  // Fetch employees
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['/api/employees'],
    staleTime: 1000 * 60
  });
  
  // Fetch event roles
  const { data: roles = [] } = useQuery<EventRole[]>({
    queryKey: [`/api/event-roles?eventId=${eventId}`],
    staleTime: 1000 * 60
  });
  
  // Fetch current assignments for this event
  const { data: assignments = [], refetch: refetchAssignments } = useQuery<EventStaffAssignment[]>({
    queryKey: [`/api/events/${eventId}/staff`],
    staleTime: 1000 * 60
  });
  
  const handleAssignStaff = async () => {
    if (!selectedRole || !selectedEmployee) {
      toast({
        title: "Validation Error",
        description: "Please select both a role and an employee",
        variant: "destructive"
      });
      return;
    }
    
    setIsAssigning(true);
    
    try {
      // Find the selected role to get its name
      const selectedRoleData = roles.find(r => r.id === parseInt(selectedRole));
      if (!selectedRoleData) {
        toast({
          title: "Error",
          description: "Invalid role selection",
          variant: "destructive"
        });
        return;
      }

      // Get event dates for start/end time
      const currentEvent = await fetch(`/api/events/${eventId}`).then(res => res.json());
      const eventStartDate = new Date(currentEvent.startDate || currentEvent.start_date);
      const eventEndDate = new Date(currentEvent.endDate || currentEvent.end_date);
      
      // Set default times (9 AM start, 5 PM end)
      eventStartDate.setHours(9, 0, 0, 0);
      eventEndDate.setHours(17, 0, 0, 0);

      const assignmentData = {
        eventId: eventId,
        employeeId: parseInt(selectedEmployee),
        role: selectedRoleData.roleName,
        startTime: eventStartDate.toISOString(),
        endTime: eventEndDate.toISOString(),
        status: "assigned"
      };
      
      await apiRequest({
        url: "/api/event-staff-assignments",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignmentData)
      });
      
      toast({
        title: "Success",
        description: "Staff member assigned successfully"
      });
      
      // Reset selection
      setSelectedRole("");
      setSelectedEmployee("");
      
      // Refresh data
      refetchAssignments();
      if (onAssignmentsUpdate) onAssignmentsUpdate();
      queryClient.invalidateQueries({ queryKey: ['/api/event-staff-assignments'] });
      
    } catch (error) {
      console.error("Error assigning staff:", error);
      toast({
        title: "Error",
        description: "Failed to assign staff. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsAssigning(false);
    }
  };
  
  const handleRemoveAssignment = async (assignmentId: number) => {
    if (!confirm("Are you sure you want to remove this staff assignment?")) return;
    
    try {
      await apiRequest({
        url: `/api/event-staff-assignments/${assignmentId}`,
        method: "DELETE"
      });
      
      toast({
        title: "Success",
        description: "Staff assignment removed"
      });
      
      refetchAssignments();
      if (onAssignmentsUpdate) onAssignmentsUpdate();
      
    } catch (error) {
      console.error("Error removing assignment:", error);
      toast({
        title: "Error",
        description: "Failed to remove assignment. Please try again.",
        variant: "destructive"
      });
    }
  };
  
  const handleUpdateStatus = async (assignmentId: number, status: string) => {
    try {
      await apiRequest({
        url: `/api/event-staff-assignments/${assignmentId}`,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      
      toast({
        title: "Success",
        description: "Assignment status updated"
      });
      
      refetchAssignments();
      
    } catch (error) {
      console.error("Error updating status:", error);
      toast({
        title: "Error",
        description: "Failed to update status. Please try again.",
        variant: "destructive"
      });
    }
  };
  
  // Group assignments by role
  const assignmentsByRole = roles.map(role => {
    const roleAssignments = assignments.filter(a => a.role === role.roleName);
    return {
      role,
      assignments: roleAssignments,
      filled: roleAssignments.length,
      needed: role.numberOfStaff || 0
    };
  });
  
  // Get available employees (not already assigned to this event)
  const assignedEmployeeIds = assignments.map(a => a.employeeId);
  const availableEmployees = employees.filter(e => !assignedEmployeeIds.includes(e.id));
  
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Staff Roster & Assignments</CardTitle>
          <div className="text-sm text-gray-600">
            Total Assigned: {assignments.length} / {roles.reduce((sum, r) => sum + (r.numberOfStaff || 0), 0)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Quick Assignment Form */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-3">Quick Staff Assignment</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="role">Select Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles.map(role => (
                    <SelectItem key={role.id} value={role.id.toString()}>
                      {role.roleName} ({assignmentsByRole.find(r => r.role.id === role.id)?.filled || 0}/{role.numberOfStaff})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="employee">Select Employee</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose employee..." />
                </SelectTrigger>
                <SelectContent>
                  {availableEmployees.length === 0 ? (
                    <SelectItem value="none" disabled>No available employees</SelectItem>
                  ) : (
                    availableEmployees.map(emp => (
                      <SelectItem key={emp.id} value={emp.id.toString()}>
                        {emp.firstName} {emp.lastName} - {emp.department}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-end">
              <Button
                onClick={handleAssignStaff}
                disabled={isAssigning || !selectedRole || !selectedEmployee}
                className="w-full"
              >
                <UserPlusIcon className="h-4 w-4 mr-2" />
                {isAssigning ? "Assigning..." : "Assign Staff"}
              </Button>
            </div>
          </div>
        </div>
        
        {/* Roster by Role */}
        <div className="space-y-4">
          {assignmentsByRole.map(({ role, assignments: roleAssignments, filled, needed }) => (
            <div key={role.id} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h4 className="font-semibold">{role.roleName}</h4>
                  <p className="text-sm text-gray-600">{role.roleDescription}</p>
                </div>
                <div className="text-right">
                  <span className={`font-semibold ${filled >= needed ? 'text-green-600' : 'text-orange-600'}`}>
                    {filled}/{needed} Filled
                  </span>
                  {role.hourlyRate && (
                    <p className="text-sm text-gray-500">QAR {role.hourlyRate}/hr</p>
                  )}
                </div>
              </div>
              
              {roleAssignments.length === 0 ? (
                <p className="text-gray-500 text-sm italic">No staff assigned yet</p>
              ) : (
                <div className="space-y-2">
                  {roleAssignments.map(assignment => {
                    const employee = employees.find(e => e.id === assignment.employeeId);
                    return (
                      <div key={assignment.id} className="flex justify-between items-center bg-gray-50 rounded p-2">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-medium">
                              {employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${assignment.employeeId}`}
                            </p>
                            <p className="text-xs text-gray-600">
                              {employee?.position} - {employee?.department}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Select
                            value={assignment.status}
                            onValueChange={(value) => handleUpdateStatus(assignment.id, value)}
                          >
                            <SelectTrigger className="w-32 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="confirmed">
                                <span className="flex items-center">
                                  <CheckCircleIcon className="h-3 w-3 mr-1 text-green-600" />
                                  Confirmed
                                </span>
                              </SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="declined">
                                <span className="flex items-center">
                                  <XCircleIcon className="h-3 w-3 mr-1 text-red-600" />
                                  Declined
                                </span>
                              </SelectItem>
                              <SelectItem value="standby">Standby</SelectItem>
                            </SelectContent>
                          </Select>
                          
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveAssignment(assignment.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <UserMinusIcon className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        
        {roles.length === 0 && (
          <p className="text-center text-gray-500 py-8">
            No roles defined for this event. Please add roles first.
          </p>
        )}
      </CardContent>
    </Card>
  );
}