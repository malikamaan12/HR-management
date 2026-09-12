import type { Employee, OnboardingChecklist } from '@shared/schema';
import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onboarding?: any;
  isEditing?: boolean;
}

export function OnboardingModal({ isOpen, onClose, onboarding, isEditing = false }: OnboardingModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    employeeId: onboarding?.employeeId || "",
    checklistId: onboarding?.checklistId || "",
    startDate: onboarding?.startDate || "",
    notes: onboarding?.notes || "",
    status: onboarding?.status || "in_progress"
  });

  const [startDateOpen, setStartDateOpen] = useState(false);

  // Fetch employees for selection
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['/api/employees'],
    enabled: isOpen
  });

  // Fetch onboarding checklists for selection
  const { data: checklists = [] } = useQuery<OnboardingChecklist[]>({
    queryKey: ['/api/onboarding-checklists'],
    enabled: isOpen
  });

  useEffect(() => {
    if (onboarding && isEditing) {
      setFormData({
        employeeId: onboarding.employeeId || "",
        checklistId: onboarding.checklistId || "",
        startDate: onboarding.startDate || "",
        notes: onboarding.notes || "",
        status: onboarding.status || "in_progress"
      });
    } else if (!isEditing) {
      setFormData({
        employeeId: "",
        checklistId: "",
        startDate: "",
        notes: "",
        status: "in_progress"
      });
    }
  }, [onboarding, isEditing, isOpen]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isEditing ? `/api/employee-onboarding/${onboarding.id}` : '/api/employee-onboarding';
      const method = isEditing ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save employee onboarding');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/employee-onboarding'] });
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-stats'] });
      toast({
        title: isEditing ? "Onboarding Updated" : "Onboarding Started",
        description: isEditing ? "The employee onboarding has been updated successfully." : "The employee onboarding has been started successfully.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    const requiredFields = ['employeeId', 'checklistId', 'startDate'];
    const missingFields = requiredFields.filter(field => !formData[field as keyof typeof formData]);
    
    if (missingFields.length > 0) {
      toast({
        title: "Missing Required Fields",
        description: `Please fill in: ${missingFields.join(', ')}`,
        variant: "destructive",
      });
      return;
    }
    
    // Convert IDs to numbers
    const submitData = {
      ...formData,
      employeeId: Number(formData.employeeId),
      checklistId: Number(formData.checklistId),
    };
    
    createMutation.mutate(submitData);
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Employee Onboarding" : "Start New Employee Onboarding"}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="employeeId">Employee *</Label>
              <Select 
                value={formData.employeeId.toString()} 
                onValueChange={(value) => handleInputChange('employeeId', value)}
                disabled={isEditing} // Don't allow changing employee once onboarding is started
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee: any) => (
                    <SelectItem key={employee.id} value={employee.id.toString()}>
                      {employee.firstName} {employee.lastName} - {employee.employeeId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="checklistId">Onboarding Checklist *</Label>
              <Select 
                value={formData.checklistId.toString()} 
                onValueChange={(value) => handleInputChange('checklistId', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select checklist" />
                </SelectTrigger>
                <SelectContent>
                  {checklists.map((checklist: any) => (
                    <SelectItem key={checklist.id} value={checklist.id.toString()}>
                      {checklist.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date *</Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.startDate ? (
                      format(new Date(formData.startDate), "PPP")
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.startDate ? new Date(formData.startDate) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        handleInputChange('startDate', date.toISOString().split('T')[0]);
                        setStartDateOpen(false);
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            {isEditing && (
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select 
                  value={formData.status} 
                  onValueChange={(value) => handleInputChange('status', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              placeholder="Optional notes about this onboarding process..."
              rows={3}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (isEditing ? "Updating..." : "Starting...") : (isEditing ? "Update Onboarding" : "Start Onboarding")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}