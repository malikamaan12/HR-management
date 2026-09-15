import {apiJson} from '@/lib/queryClient';
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChecklistTask {
  id?: number;
  taskName: string;
  description: string;
  category: string;
  assignedTo: string;
  daysFromStart: number;
  isRequired: boolean;
}

interface OnboardingChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  checklist?: any;
  isEditing?: boolean;
}

export function OnboardingChecklistModal({ isOpen, onClose, checklist, isEditing = false }: OnboardingChecklistModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    name: checklist?.name || "",
    description: checklist?.description || "",
    departmentSpecific: checklist?.departmentSpecific || "",
    employeeTypeSpecific: checklist?.employeeTypeSpecific || ""
  });

  const [tasks, setTasks] = useState<ChecklistTask[]>([]);
  const [reason,setReason]=useState('');
  const detail=useQuery<any>({queryKey:[`/api/onboarding-checklists/${checklist?.id}`],enabled:isOpen&&isEditing&&!!checklist?.id});
  const [showHistory,setShowHistory]=useState(false);
  const history=useQuery<any[]>({queryKey:[`/api/onboarding-checklists/${checklist?.id}/history`],enabled:isOpen&&isEditing&&showHistory});

  useEffect(() => {
    if (checklist && isEditing && detail.data) {
      const checklist=detail.data;
      setFormData({
        name: checklist.name || "",
        description: checklist.description || "",
        departmentSpecific: checklist.departmentSpecific || "",
        employeeTypeSpecific: checklist.employeeTypeSpecific || ""
      });
      
      // If editing, fetch existing tasks
      if (checklist.tasks) {
        setTasks(checklist.tasks);
      }
    } else if (!isEditing) {
      setFormData({
        name: "",
        description: "",
        departmentSpecific: "",
        employeeTypeSpecific: ""
      });
      setTasks([]);
    }
  }, [checklist, isEditing, isOpen, detail.data]);

  const createChecklistMutation = useMutation({
    mutationFn: async (data:any)=>apiJson(isEditing?`/api/onboarding-checklists/${checklist.id}`:'/api/onboarding-checklists',{method:isEditing?'PUT':'POST',body:data}),
    onSuccess:async()=>{
      await queryClient.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/onboarding-checklists')});
      toast({title:'Checklist version saved'});setReason('');onClose();
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
    
    if (!formData.name.trim()) {
      toast({
        title: "Missing Required Fields",
        description: "Please provide a checklist name.",
        variant: "destructive",
      });
      return;
    }
    
    createChecklistMutation.mutate({...formData,employeeTypeSpecific:formData.employeeTypeSpecific==='all'?'':formData.employeeTypeSpecific,departmentSpecific:formData.departmentSpecific==='all'?'':formData.departmentSpecific,expectedVersion:isEditing?detail.data?.version:0,reason,tasks:tasks.map(({taskName,description,category,assignedTo,daysFromStart,isRequired})=>({taskName,description:description||'',category,assignedTo,daysFromStart,isRequired:!!isRequired}))});
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addTask = () => {
    setTasks(prev => [...prev, {
      taskName: "",
      description: "",
      category: "first_day",
      assignedTo: "hr",
      daysFromStart: 0,
      isRequired: true
    }]);
  };

  const updateTask = (index: number, field: string, value: any) => {
    setTasks(prev => prev.map((task, i) => 
      i === index ? { ...task, [field]: value } : task
    ));
  };

  const removeTask = (index: number) => {
    setTasks(prev => prev.filter((_, i) => i !== index));
  };

  const getCategoryBadgeColor = (category: string) => {
    const colors: Record<string, string> = {
      'pre-joining': 'bg-blue-100 text-blue-800',
      'first_day': 'bg-green-100 text-green-800',
      'first_week': 'bg-yellow-100 text-yellow-800',
      'first_month': 'bg-purple-100 text-purple-800'
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {isEditing&&detail.isLoading&&<p>Loading checklist…</p>}
        {isEditing&&detail.error&&<p role="alert">Unable to load checklist. Close and reopen before editing.</p>}
        <label className="grid gap-1">Checklist change reason<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500}/></label>
        {isEditing&&<><Button type="button" variant="outline" onClick={()=>setShowHistory(!showHistory)}>Version history</Button>{showHistory&&(history.error?<p role="alert">Unable to load history.</p>:<ul>{history.data?.map(v=><li key={v.version}>v{v.version} · {v.snapshot.reason} · {v.snapshot.tasks.length} tasks</li>)}</ul>)}</>}
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Onboarding Checklist" : "Create Onboarding Checklist"}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Checklist Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="e.g., Standard Onboarding, Manager Onboarding"
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="departmentSpecific">Department (Optional)</Label>
                  <Input
                    id="departmentSpecific"
                    value={formData.departmentSpecific}
                    onChange={(e) => handleInputChange('departmentSpecific', e.target.value)}
                    placeholder="e.g., IT, HR, Sales"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employeeTypeSpecific">Employee Type (Optional)</Label>
                  <Select 
                    value={formData.employeeTypeSpecific} 
                    onValueChange={(value) => handleInputChange('employeeTypeSpecific', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="permanent">Permanent</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="temporary">Temporary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Brief description of this checklist..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Checklist Tasks</CardTitle>
              <Button type="button" onClick={addTask} size="sm">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Task
              </Button>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No tasks added yet. Click "Add Task" to get started.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {tasks.map((task, index) => (
                    <Card key={index} className="border border-gray-200">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center space-x-2">
                            <Badge className={getCategoryBadgeColor(task.category)}>
                              {task.category.replace('_', ' ')}
                            </Badge>
                            {task.isRequired && (
                              <Badge variant="destructive">Required</Badge>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeTask(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Task Name *</Label>
                            <Input
                              value={task.taskName}
                              onChange={(e) => updateTask(index, 'taskName', e.target.value)}
                              placeholder="e.g., Complete IT setup"
                            />
                          </div>
                          
                          <div className="space-y-2">
                            <Label>Category</Label>
                            <Select 
                              value={task.category} 
                              onValueChange={(value) => updateTask(index, 'category', value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pre-joining">Pre-joining</SelectItem>
                                <SelectItem value="first_day">First Day</SelectItem>
                                <SelectItem value="first_week">First Week</SelectItem>
                                <SelectItem value="first_month">First Month</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 mt-4">
                          <div className="space-y-2">
                            <Label>Assigned To</Label>
                            <Select 
                              value={task.assignedTo} 
                              onValueChange={(value) => updateTask(index, 'assignedTo', value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="hr">HR</SelectItem>
                                <SelectItem value="manager">Manager</SelectItem>
                                <SelectItem value="it">IT</SelectItem>
                                <SelectItem value="new_hire">New Hire</SelectItem>
                                <SelectItem value="finance">Finance</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-2">
                            <Label>Days from Start</Label>
                            <Input
                              type="number"
                              value={task.daysFromStart}
                              onChange={(e) => updateTask(index, 'daysFromStart', parseInt(e.target.value) || 0)}
                              min="0"
                              max="90"
                            />
                          </div>
                          
                          <div className="space-y-2">
                            <Label>Required Task</Label>
                            <div className="flex items-center space-x-2 mt-2">
                              <Switch
                                checked={task.isRequired}
                                onCheckedChange={(checked) => updateTask(index, 'isRequired', checked)}
                              />
                              <span className="text-sm">{task.isRequired ? 'Required' : 'Optional'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4">
                          <Label>Description</Label>
                          <Textarea
                            value={task.description}
                            onChange={(e) => updateTask(index, 'description', e.target.value)}
                            placeholder="Detailed description of the task..."
                            rows={2}
                            className="mt-1"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createChecklistMutation.isPending||reason.trim().length<5||(isEditing&&(!detail.data||detail.isError))}>
              {createChecklistMutation.isPending ? "Creating..." : "Create Checklist"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
