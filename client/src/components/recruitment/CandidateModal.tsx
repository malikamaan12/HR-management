import {CandidateCorrections} from './CandidateCorrections';
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CandidateModalProps {
  isOpen: boolean;
  onClose: () => void;
  candidate?: any;
  isEditing?: boolean;
}

export function CandidateModal(props:CandidateModalProps){return props.candidate?<CandidateCorrections key={props.candidate.id} isOpen={props.isOpen} onClose={props.onClose} candidateId={props.candidate.id}/>:<CreateCandidateModal {...props}/>;}
function CreateCandidateModal({ isOpen, onClose, candidate, isEditing = false }: CandidateModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    fullNameEn: candidate?.fullNameEn || "",
    fullNameAr: candidate?.fullNameAr || "",
    email: candidate?.email || "",
    phone: candidate?.phone || "",
    linkedinProfile: candidate?.linkedinProfile || "",
    qidNumber: candidate?.qidNumber || "",
    visaStatus: candidate?.visaStatus || "",
    source: candidate?.source || "job_board",
    referralEmployeeId: candidate?.referralEmployeeId || null
  });

  const [skills, setSkills] = useState(candidate?.skills || []);
  const [experience, setExperience] = useState(candidate?.experience || []);
  const [education, setEducation] = useState(candidate?.education || []);

  const addSkill = () => {
    setSkills([...skills, { skillName: "", proficiencyLevel: "intermediate" }]);
  };

  const updateSkill = (index: number, field: string, value: string) => {
    const updated = [...skills];
    updated[index] = { ...updated[index], [field]: value };
    setSkills(updated);
  };

  const removeSkill = (index: number) => {
    setSkills(skills.filter((_: any, i: number) => i !== index));
  };

  const addExperience = () => {
    setExperience([...experience, {
      jobTitle: "",
      company: "",
      startDate: "",
      endDate: "",
      isCurrentJob: false,
      description: ""
    }]);
  };

  const updateExperience = (index: number, field: string, value: any) => {
    const updated = [...experience];
    updated[index] = { ...updated[index], [field]: value };
    setExperience(updated);
  };

  const removeExperience = (index: number) => {
    setExperience(experience.filter((_: any, i: number) => i !== index));
  };

  const addEducation = () => {
    setEducation([...education, {
      degree: "",
      institution: "",
      fieldOfStudy: "",
      startDate: "",
      endDate: "",
      isCurrentStudy: false
    }]);
  };

  const updateEducation = (index: number, field: string, value: any) => {
    const updated = [...education];
    updated[index] = { ...updated[index], [field]: value };
    setEducation(updated);
  };

  const removeEducation = (index: number) => {
    setEducation(education.filter((_: any, i: number) => i !== index));
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save candidate');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/candidates'] });
      toast({
        title: "Candidate Created",
        description: "The candidate has been added successfully.",
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
    createMutation.mutate({
      ...formData,
      skills,
      experience,
      education
    });
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Candidate" : "Add New Candidate"}
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="experience">Experience</TabsTrigger>
            <TabsTrigger value="education">Education</TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit}>
            <TabsContent value="basic" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fullNameEn">Full Name (English) *</Label>
                  <Input
                    id="fullNameEn"
                    value={formData.fullNameEn}
                    onChange={(e) => handleInputChange('fullNameEn', e.target.value)}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="fullNameAr">Full Name (Arabic)</Label>
                  <Input
                    id="fullNameAr"
                    value={formData.fullNameAr}
                    onChange={(e) => handleInputChange('fullNameAr', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone *</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="qidNumber">QID Number</Label>
                  <Input
                    id="qidNumber"
                    value={formData.qidNumber}
                    onChange={(e) => handleInputChange('qidNumber', e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="visaStatus">Visa Status</Label>
                  <Input
                    id="visaStatus"
                    value={formData.visaStatus}
                    onChange={(e) => handleInputChange('visaStatus', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="linkedinProfile">LinkedIn Profile</Label>
                  <Input
                    id="linkedinProfile"
                    value={formData.linkedinProfile}
                    onChange={(e) => handleInputChange('linkedinProfile', e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="source">Application Source *</Label>
                  <Select value={formData.source} onValueChange={(value) => handleInputChange('source', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="job_board">Job Board</SelectItem>
                      <SelectItem value="company_website">Company Website</SelectItem>
                      <SelectItem value="referral">Referral</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="social_media">Social Media</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="skills" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Skills</h3>
                <Button type="button" onClick={addSkill} variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Skill
                </Button>
              </div>
              
              <div className="space-y-3">
                {skills.map((skill: any, index: number) => (
                  <Card key={index}>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-3 gap-4 items-end">
                        <div className="space-y-2">
                          <Label>Skill Name</Label>
                          <Input
                            value={skill.skillName}
                            onChange={(e) => updateSkill(index, 'skillName', e.target.value)}
                            placeholder="e.g., JavaScript"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Proficiency Level</Label>
                          <Select 
                            value={skill.proficiencyLevel} 
                            onValueChange={(value) => updateSkill(index, 'proficiencyLevel', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="beginner">Beginner</SelectItem>
                              <SelectItem value="intermediate">Intermediate</SelectItem>
                              <SelectItem value="advanced">Advanced</SelectItem>
                              <SelectItem value="expert">Expert</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm"
                          onClick={() => removeSkill(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="experience" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Work Experience</h3>
                <Button type="button" onClick={addExperience} variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Experience
                </Button>
              </div>
              
              <div className="space-y-4">
                {experience.map((exp: any, index: number) => (
                  <Card key={index}>
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex justify-end">
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm"
                          onClick={() => removeExperience(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Job Title</Label>
                          <Input
                            value={exp.jobTitle}
                            onChange={(e) => updateExperience(index, 'jobTitle', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Company</Label>
                          <Input
                            value={exp.company}
                            onChange={(e) => updateExperience(index, 'company', e.target.value)}
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Start Date</Label>
                          <Input
                            type="date"
                            value={exp.startDate}
                            onChange={(e) => updateExperience(index, 'startDate', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>End Date</Label>
                          <Input
                            type="date"
                            value={exp.endDate}
                            onChange={(e) => updateExperience(index, 'endDate', e.target.value)}
                            disabled={exp.isCurrentJob}
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          value={exp.description}
                          onChange={(e) => updateExperience(index, 'description', e.target.value)}
                          rows={3}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="education" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Education</h3>
                <Button type="button" onClick={addEducation} variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Education
                </Button>
              </div>
              
              <div className="space-y-4">
                {education.map((edu: any, index: number) => (
                  <Card key={index}>
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex justify-end">
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm"
                          onClick={() => removeEducation(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Degree</Label>
                          <Input
                            value={edu.degree}
                            onChange={(e) => updateEducation(index, 'degree', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Institution</Label>
                          <Input
                            value={edu.institution}
                            onChange={(e) => updateEducation(index, 'institution', e.target.value)}
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Field of Study</Label>
                        <Input
                          value={edu.fieldOfStudy}
                          onChange={(e) => updateEducation(index, 'fieldOfStudy', e.target.value)}
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Start Date</Label>
                          <Input
                            type="date"
                            value={edu.startDate}
                            onChange={(e) => updateEducation(index, 'startDate', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>End Date</Label>
                          <Input
                            type="date"
                            value={edu.endDate}
                            onChange={(e) => updateEducation(index, 'endDate', e.target.value)}
                            disabled={edu.isCurrentStudy}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <div className="flex justify-end space-x-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Save"} Candidate
              </Button>
            </div>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}