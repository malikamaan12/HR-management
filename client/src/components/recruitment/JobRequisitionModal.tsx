import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface JobRequisitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  requisition?: any;
  isEditing?: boolean;
}

export function JobRequisitionModal({ isOpen, onClose, requisition, isEditing = false }: JobRequisitionModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    jobTitle: requisition?.jobTitle || "",
    department: requisition?.department || "",
    location: requisition?.location || "",
    positionType: requisition?.positionType || "permanent",
    salaryRange: requisition?.salaryRange || "",
    numberOfVacancies: requisition?.numberOfVacancies || 1,
    jobDescription: requisition?.jobDescription || "",
    qualifications: requisition?.qualifications || "",
    responsibilities: requisition?.responsibilities || "",
    requiredSkills: requisition?.requiredSkills || "",
    preferredSkills: requisition?.preferredSkills || "",
    postingStartDate: requisition?.postingStartDate || null,
    postingEndDate: requisition?.postingEndDate || null,
    isInternal: requisition?.isInternal || false,
    requestedBy: requisition?.requestedBy || null // Will be set by server if not provided
  });

  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isEditing ? `/api/job-requisitions/${requisition.id}` : '/api/job-requisitions';
      const method = isEditing ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save job requisition');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/job-requisitions'] });
      toast({
        title: isEditing ? "Job Requisition Updated" : "Job Requisition Created",
        description: isEditing ? "The job requisition has been updated successfully." : "The job requisition has been created successfully.",
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
    
    // Ensure all required fields are filled
    const requiredFields = [
      'jobTitle', 'department', 'location', 'positionType',
      'jobDescription', 'qualifications', 'responsibilities', 'requiredSkills'
    ];
    
    const missingFields = requiredFields.filter(field => !formData[field as keyof typeof formData]);
    
    if (missingFields.length > 0) {
      toast({
        title: "Missing Required Fields",
        description: `Please fill in: ${missingFields.join(', ')}`,
        variant: "destructive",
      });
      return;
    }
    
    // Clean up the data before sending - remove requestedBy completely
    const { requestedBy, ...cleanData } = formData;
    const submitData = {
      ...cleanData,
      numberOfVacancies: Number(formData.numberOfVacancies) || 1,
    };
    
    createMutation.mutate(submitData);
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Job Requisition" : "Create Job Requisition"}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="jobTitle">Job Title *</Label>
              <Input
                id="jobTitle"
                value={formData.jobTitle}
                onChange={(e) => handleInputChange('jobTitle', e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="department">Department *</Label>
              <Input
                id="department"
                value={formData.department}
                onChange={(e) => handleInputChange('department', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="location">Location *</Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="positionType">Position Type *</Label>
              <Select value={formData.positionType} onValueChange={(value) => handleInputChange('positionType', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="permanent">Permanent</SelectItem>
                  <SelectItem value="temporary">Temporary</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="numberOfVacancies">Number of Vacancies *</Label>
              <Input
                id="numberOfVacancies"
                type="number"
                min="1"
                value={formData.numberOfVacancies}
                onChange={(e) => handleInputChange('numberOfVacancies', parseInt(e.target.value))}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="salaryRange">Salary Range</Label>
              <Input
                id="salaryRange"
                placeholder="e.g., QAR 8,000 - 12,000"
                value={formData.salaryRange}
                onChange={(e) => handleInputChange('salaryRange', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="jobDescription">Job Description *</Label>
            <Textarea
              id="jobDescription"
              rows={4}
              value={formData.jobDescription}
              onChange={(e) => handleInputChange('jobDescription', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qualifications">Qualifications *</Label>
            <Textarea
              id="qualifications"
              rows={3}
              value={formData.qualifications}
              onChange={(e) => handleInputChange('qualifications', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="responsibilities">Responsibilities *</Label>
            <Textarea
              id="responsibilities"
              rows={3}
              value={formData.responsibilities}
              onChange={(e) => handleInputChange('responsibilities', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="requiredSkills">Required Skills *</Label>
              <Textarea
                id="requiredSkills"
                rows={2}
                value={formData.requiredSkills}
                onChange={(e) => handleInputChange('requiredSkills', e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="preferredSkills">Preferred Skills</Label>
              <Textarea
                id="preferredSkills"
                rows={2}
                value={formData.preferredSkills}
                onChange={(e) => handleInputChange('preferredSkills', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Posting Start Date</Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.postingStartDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.postingStartDate ? format(new Date(formData.postingStartDate), "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.postingStartDate ? new Date(formData.postingStartDate) : undefined}
                    onSelect={(date) => {
                      handleInputChange('postingStartDate', date?.toISOString().split('T')[0] || null);
                      setStartDateOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="space-y-2">
              <Label>Posting End Date</Label>
              <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.postingEndDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.postingEndDate ? format(new Date(formData.postingEndDate), "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.postingEndDate ? new Date(formData.postingEndDate) : undefined}
                    onSelect={(date) => {
                      handleInputChange('postingEndDate', date?.toISOString().split('T')[0] || null);
                      setEndDateOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isInternal"
              checked={formData.isInternal}
              onCheckedChange={(checked) => handleInputChange('isInternal', checked)}
            />
            <Label htmlFor="isInternal">Internal Position Only</Label>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : (isEditing ? "Update" : "Create")} Requisition
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}