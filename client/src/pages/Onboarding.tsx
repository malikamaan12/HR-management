import {Offboarding} from '@/components/onboarding/Offboarding';
import {TaskEditor} from '@/components/onboarding/TaskEditor';
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  PlusCircle, 
  Search, 
  Users, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  User,
  Calendar,
  ListChecks,
  FileText,
  Edit,
  Eye
} from "lucide-react";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { OnboardingChecklistModal } from "@/components/onboarding/OnboardingChecklistModal";

interface OnboardingStats {
  totalOnboardings: number;
  inProgress: number;
  completed: number;
  avgProgress: number;
  recentOnboardings: Array<{
    id: number;
    employeeName: string;
    startDate: string;
    status: string;
    progress: number;
  }>;
  upcomingTasks: Array<{
    id: number;
    taskName: string;
    employeeName: string;
    dueDate: string;
    assignedTo: string;
    status: string;
  }>;
}

interface EmployeeOnboarding {
  id: number;
  employeeId: number;
  employeeName: string;
  checklistName: string;
  startDate: string;
  endDate?: string;
  status: string;
  progress: number;
  notes?: string;
  createdAt: string;
  completedTasks: number;
  totalTasks: number;
}

interface OnboardingChecklist {
  id: number;
  name: string;
  description?: string;
  departmentSpecific?: string;
  employeeTypeSpecific?: string;
  createdAt: string;
  taskCount: number;
}

interface OnboardingTask {
  version:number;
  id: number;
  onboardingId: number;
  employeeName: string;
  taskName: string;
  description?: string;
  category: string;
  assignedTo: string;
  assigneeId?: number;
  assigneeName?: string;
  dueDate: string;
  completedDate?: string;
  status: string;
  comments?: string;
  documentUrl?: string;
  isRequired: boolean;
}

export default function Onboarding() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // Modal states
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false);
  const [selectedOnboarding, setSelectedOnboarding] = useState(null);
  const [selectedChecklist, setSelectedChecklist] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // Fetch data with React Query
  const { data: stats, isLoading: isLoadingStats } = useQuery<OnboardingStats>({
    queryKey: ['/api/onboarding-stats'],
    enabled: activeTab === "dashboard"
  });

  const { data: onboardings = [], isLoading: isLoadingOnboardings } = useQuery<EmployeeOnboarding[]>({
    queryKey: ['/api/employee-onboarding'],
    enabled: activeTab === "onboardings"
  });

  const { data: checklists = [], isLoading: isLoadingChecklists } = useQuery<OnboardingChecklist[]>({
    queryKey: ['/api/onboarding-checklists'],
    enabled: activeTab === "checklists"
  });

  const { data: tasks = [], isLoading: isLoadingTasks } = useQuery<OnboardingTask[]>({
    queryKey: ['/api/onboarding-tasks'],
    enabled: activeTab === "tasks"
  });

  // Filter functions
  const filterItems = (items: any[], query: string, status: string) => {
    return items.filter(item => {
      const matchesQuery = !query || 
        Object.values(item).some(value => 
          value?.toString().toLowerCase().includes(query.toLowerCase())
        );
      const matchesStatus = status === 'all' || item.status === status;
      return matchesQuery && matchesStatus;
    });
  };

  const filteredOnboardings = filterItems(onboardings, searchQuery, statusFilter);
  const filteredChecklists = filterItems(checklists, searchQuery, 'all');
  const filteredTasks = filterItems(tasks, searchQuery, statusFilter);

  // Status badge helper
  const getStatusBadge = (status: string, variant?: string) => {
    const statusConfig: Record<string, { variant: string; label: string }> = {
      in_progress: { variant: "default", label: "In Progress" },
      completed: { variant: "success", label: "Completed" },
      cancelled: { variant: "destructive", label: "Cancelled" },
      not_started: { variant: "secondary", label: "Not Started" },
      on_hold: { variant: "warning", label: "On Hold" },
      overdue: { variant: "destructive", label: "Overdue" }
    };
    
    const config = statusConfig[status] || { variant: "secondary", label: status };
    
    return (
      <Badge variant={config.variant as any}>{config.label}</Badge>
    );
  };

  // Modal handlers
  const handleCreateOnboarding = () => {
    setSelectedOnboarding(null);
    setIsEditing(false);
    setIsOnboardingModalOpen(true);
  };

  const handleEditOnboarding = (onboarding: any) => {
    setSelectedOnboarding(onboarding);
    setIsEditing(true);
    setIsOnboardingModalOpen(true);
  };

  const handleCreateChecklist = () => {
    setSelectedChecklist(null);
    setIsEditing(false);
    setIsChecklistModalOpen(true);
  };

  const handleEditChecklist = (checklist: any) => {
    setSelectedChecklist(checklist);
    setIsEditing(true);
    setIsChecklistModalOpen(true);
  };

  return (
    <div className="container p-6 mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Employee Onboarding</h1>
        <div className="flex space-x-2">
          {activeTab === "onboardings" && (
            <Button onClick={handleCreateOnboarding}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Start New Onboarding
            </Button>
          )}
          {activeTab === "checklists" && (
            <Button onClick={handleCreateChecklist}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Checklist
            </Button>
          )}
        </div>
      </div>

      {/* Search and Filter */}
      {activeTab !== "dashboard" && (
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center w-full max-w-sm">
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
            />
            <Search className="ml-2 h-5 w-5 text-muted-foreground" />
          </div>
          {(activeTab === "onboardings" || activeTab === "tasks") && (
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">Status:</span>
              <Select
                value={statusFilter}
                onValueChange={setStatusFilter}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      <Offboarding/>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard" className="flex items-center">
            <Users className="mr-2 h-4 w-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="onboardings" className="flex items-center">
            <User className="mr-2 h-4 w-4" />
            Employee Onboardings
          </TabsTrigger>
          <TabsTrigger value="checklists" className="flex items-center">
            <ListChecks className="mr-2 h-4 w-4" />
            Checklists
          </TabsTrigger>
          <TabsTrigger value="tasks" className="flex items-center">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Tasks
          </TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard">
          {isLoadingStats ? (
            <div className="flex justify-center p-6">Loading dashboard...</div>
          ) : (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Onboardings</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats?.totalOnboardings || 0}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats?.inProgress || 0}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completed</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats?.completed || 0}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Progress</CardTitle>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{Math.round(stats?.avgProgress || 0)}%</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Recent Onboardings */}
                <Card>
                  <CardHeader>
                    <CardTitle>Recent Onboardings</CardTitle>
                    <CardDescription>Latest employee onboarding processes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {stats?.recentOnboardings?.length ? (
                      <div className="space-y-4">
                        {stats.recentOnboardings.map((onboarding) => (
                          <div key={onboarding.id} className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{onboarding.employeeName}</p>
                              <p className="text-sm text-muted-foreground">
                                Started: {new Date(onboarding.startDate).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              {getStatusBadge(onboarding.status)}
                              <div className="mt-1">
                                <Progress value={onboarding.progress} className="w-20" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No recent onboardings</p>
                    )}
                  </CardContent>
                </Card>

                {/* Upcoming Tasks */}
                <Card>
                  <CardHeader>
                    <CardTitle>Upcoming Tasks</CardTitle>
                    <CardDescription>Tasks due in the next 7 days</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {stats?.upcomingTasks?.length ? (
                      <div className="space-y-4">
                        {stats.upcomingTasks.map((task) => (
                          <div key={task.id} className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{task.taskName}</p>
                              <p className="text-sm text-muted-foreground">
                                {task.employeeName} • Due: {new Date(task.dueDate).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <Badge variant="outline">{task.assignedTo}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No upcoming tasks</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Employee Onboardings Tab */}
        <TabsContent value="onboardings">
          <Card>
            <CardHeader>
              <CardTitle>Employee Onboardings</CardTitle>
              <CardDescription>
                Track and manage employee onboarding processes
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOnboardings ? (
                <div className="flex justify-center p-6">Loading onboardings...</div>
              ) : filteredOnboardings.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Checklist</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tasks</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOnboardings.map((onboarding) => (
                      <TableRow key={onboarding.id}>
                        <TableCell className="font-medium">{onboarding.employeeName}</TableCell>
                        <TableCell>{onboarding.checklistName}</TableCell>
                        <TableCell>{new Date(onboarding.startDate).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Progress value={onboarding.progress} className="w-16" />
                            <span className="text-sm">{onboarding.progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(onboarding.status)}</TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {onboarding.completedTasks}/{onboarding.totalTasks}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleEditOnboarding(onboarding)}>
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center p-6">
                  <Users className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No employee onboardings found</p>
                  <Button size="sm" onClick={handleCreateOnboarding}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Start New Onboarding
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Checklists Tab */}
        <TabsContent value="checklists">
          <Card>
            <CardHeader>
              <CardTitle>Onboarding Checklists</CardTitle>
              <CardDescription>
                Manage onboarding checklist templates for different roles and departments
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingChecklists ? (
                <div className="flex justify-center p-6">Loading checklists...</div>
              ) : filteredChecklists.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredChecklists.map((checklist) => (
                    <Card key={checklist.id} className="cursor-pointer hover:shadow-md">
                      <CardHeader>
                        <CardTitle className="text-lg">{checklist.name}</CardTitle>
                        <CardDescription>{checklist.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {checklist.departmentSpecific && (
                            <Badge variant="outline">Dept: {checklist.departmentSpecific}</Badge>
                          )}
                          {checklist.employeeTypeSpecific && (
                            <Badge variant="outline">Type: {checklist.employeeTypeSpecific}</Badge>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                              {checklist.taskCount} tasks
                            </span>
                            <div className="flex space-x-2">
                              <Button variant="ghost" size="sm">
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleEditChecklist(checklist)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-6">
                  <ListChecks className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No onboarding checklists found</p>
                  <Button size="sm" onClick={handleCreateChecklist}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Create Checklist
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks">
          <Card>
            <CardHeader>
              <CardTitle>Onboarding Tasks</CardTitle>
              <CardDescription>
                View and manage all onboarding tasks across employees
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingTasks ? (
                <div className="flex justify-center p-6">Loading tasks...</div>
              ) : filteredTasks.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Assigned To</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{task.taskName}</p>
                            {task.isRequired && (
                              <Badge variant="destructive" className="text-xs">Required</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{task.employeeName}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{task.category}</Badge>
                        </TableCell>
                        <TableCell>
                          {task.assigneeName || task.assignedTo}
                        </TableCell>
                        <TableCell>{new Date(task.dueDate).toLocaleDateString()}</TableCell>
                        <TableCell>{getStatusBadge(task.status)}<TaskEditor task={task}/></TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center p-6">
                  <CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No onboarding tasks found</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={() => setIsOnboardingModalOpen(false)}
        onboarding={selectedOnboarding}
        isEditing={isEditing}
      />

      <OnboardingChecklistModal
        isOpen={isChecklistModalOpen}
        onClose={() => setIsChecklistModalOpen(false)}
        checklist={selectedChecklist}
        isEditing={isEditing}
      />
    </div>
  );
}