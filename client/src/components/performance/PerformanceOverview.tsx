import type { PerformanceStats, ApiReview, ApiGoal, ApiFeedback, ApiEmployee } from '@/lib/api-types';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CalendarIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  UserIcon,
  TrendingUpIcon,
  AwardIcon,
  BarChart4Icon,
  EditIcon,
  EyeIcon,
  PlusIcon,
  StarIcon,
  MessageSquareIcon,
  TargetIcon,
  ChevronRightIcon,
} from 'lucide-react';
import { formatDistance, format } from 'date-fns';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

const PerformanceOverview = () => {
  const [activeTab, setActiveTab] = useState('reviews');
  const [isCreateReviewModalOpen, setIsCreateReviewModalOpen] = useState(false);
  const [isCreateGoalModalOpen, setIsCreateGoalModalOpen] = useState(false);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [newReview, setNewReview] = useState({
    employeeId: '',
    reviewType: 'annual',
    reviewPeriodStart: '',
    reviewPeriodEnd: '',
    dueDate: ''
  });
  const [newGoal, setNewGoal] = useState({
    employeeId: '',
    title: '',
    description: '',
    category: 'performance',
    startDate: '',
    dueDate: ''
  });
  const [newFeedback, setNewFeedback] = useState({
    employeeId: '',
    feedbackType: 'positive',
    subject: '',
    content: ''
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch dashboard stats
  const { data: dashboardStats, isLoading: isLoadingDashboard } = useQuery<PerformanceStats>({
    queryKey: ['/api/performance/dashboard-stats'],
  });

  // Fetch all reviews
  const { data: reviews = [], isLoading: isLoadingReviews } = useQuery<ApiReview[]>({
    queryKey: ['/api/performance/reviews'],
  });

  // Fetch all goals
  const { data: goals = [], isLoading: isLoadingGoals } = useQuery<ApiGoal[]>({
    queryKey: ['/api/performance/goals'],
  });

  // Fetch all feedback
  const { data: feedback = [], isLoading: isLoadingFeedback } = useQuery<ApiFeedback[]>({
    queryKey: ['/api/performance/feedback'],
  });

  // Fetch employees for dropdowns
  const { data: employees = [], isLoading: isLoadingEmployees } = useQuery<ApiEmployee[]>({
    queryKey: ['/api/employees'],
  });

  // Mutations
  const createReviewMutation = useMutation({
    mutationFn: (reviewData: any) => apiRequest('/api/performance/reviews', {
      method: 'POST',
      body: JSON.stringify(reviewData),
    }),
    onSuccess: () => {
      toast({ title: 'Success', description: 'Performance review created successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/performance/reviews'] });
      setIsCreateReviewModalOpen(false);
      setNewReview({ employeeId: '', reviewType: 'annual', reviewPeriodStart: '', reviewPeriodEnd: '', dueDate: '' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: 'Failed to create performance review.', variant: 'destructive' });
    },
  });

  const createGoalMutation = useMutation({
    mutationFn: (goalData: any) => apiRequest('/api/performance/goals', {
      method: 'POST',
      body: JSON.stringify(goalData),
    }),
    onSuccess: () => {
      toast({ title: 'Success', description: 'Employee goal created successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/performance/goals'] });
      setIsCreateGoalModalOpen(false);
      setNewGoal({ employeeId: '', title: '', description: '', category: 'performance', startDate: '', dueDate: '' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: 'Failed to create employee goal.', variant: 'destructive' });
    },
  });

  const createFeedbackMutation = useMutation({
    mutationFn: (feedbackData: any) => apiRequest('/api/performance/feedback', {
      method: 'POST',
      body: JSON.stringify(feedbackData),
    }),
    onSuccess: () => {
      toast({ title: 'Success', description: 'Employee feedback submitted successfully.' });
      queryClient.invalidateQueries({ queryKey: ['/api/performance/feedback'] });
      setIsFeedbackModalOpen(false);
      setNewFeedback({ employeeId: '', feedbackType: 'positive', subject: '', content: '' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: 'Failed to submit employee feedback.', variant: 'destructive' });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'in_progress':
        return 'bg-blue-500';
      case 'not_started':
        return 'bg-gray-500';
      case 'draft':
        return 'bg-gray-400';
      case 'self_review':
        return 'bg-yellow-500';
      case 'manager_review':
        return 'bg-orange-500';
      case 'hr_review':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch (error) {
      return 'Invalid date';
    }
  };

  const getTimeAgo = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return formatDistance(date, new Date(), { addSuffix: true });
    } catch (error) {
      return 'Unknown time';
    }
  };

  const getRatingStars = (rating: string) => {
    const ratingMap = {
      'exceptional': 5,
      'exceeds': 4,
      'meets': 3,
      'needs_improvement': 2,
      'unsatisfactory': 1
    };
    const stars = ratingMap[rating as keyof typeof ratingMap] || 0;
    return Array.from({ length: 5 }, (_, i) => (
      <StarIcon
        key={i}
        className={`h-4 w-4 ${i < stars ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
      />
    ));
  };

  const getEmployeeName = (employeeId: number) => {
    const employee = employees.find((e: any) => e.id === employeeId);
    return employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${employeeId}`;
  };

  const handleCreateReview = () => {
    if (!newReview.employeeId || !newReview.reviewPeriodStart || !newReview.reviewPeriodEnd || !newReview.dueDate) {
      toast({ title: 'Error', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }
    createReviewMutation.mutate(newReview);
  };

  const handleCreateGoal = () => {
    if (!newGoal.employeeId || !newGoal.title || !newGoal.description || !newGoal.dueDate) {
      toast({ title: 'Error', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }
    createGoalMutation.mutate(newGoal);
  };

  const handleCreateFeedback = () => {
    if (!newFeedback.employeeId || !newFeedback.subject || !newFeedback.content) {
      toast({ title: 'Error', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }
    createFeedbackMutation.mutate(newFeedback);
  };

  const DashboardStats = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-500">
            Average Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">
            {isLoadingDashboard ? '...' : `${dashboardStats?.avgRating || 0}%`}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isLoadingDashboard ? '' : `${dashboardStats?.totalReviews || 0} reviews completed`}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-500">
            Pending Reviews
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">
            {isLoadingDashboard ? '...' : dashboardStats?.upcomingReviews || 0}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Reviews to be completed
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-500">
            Employee Goals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {isLoadingGoals ? '...' : goals.length || 0}
          </div>
          <div className="flex gap-2 mt-1">
            <Badge variant="outline" className="bg-green-100 text-green-800">
              {goals.filter((g: any) => g.status === 'completed').length || 0} Done
            </Badge>
            <Badge variant="outline" className="bg-blue-100 text-blue-800">
              {goals.filter((g: any) => g.status === 'in_progress').length || 0} Active
            </Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-500">
            Recent Feedback
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-purple-600">
            {isLoadingFeedback ? '...' : feedback.length || 0}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Total feedback entries
          </p>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Performance Management</h1>
        <div className="flex space-x-2">
          <Button variant="outline">
            <TrendingUpIcon className="mr-2 h-4 w-4" />
            Export Reports
          </Button>
          <Dialog open={isCreateReviewModalOpen} onOpenChange={setIsCreateReviewModalOpen}>
            <DialogTrigger asChild>
              <Button>
                <ClipboardCheckIcon className="mr-2 h-4 w-4" />
                New Review
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Performance Review</DialogTitle>
                <DialogDescription>
                  Create a new performance review for an employee.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="employee">Employee</Label>
                  <Select value={newReview.employeeId} onValueChange={(value) => setNewReview({...newReview, employeeId: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((employee: any) => (
                        <SelectItem key={employee.id} value={employee.id.toString()}>
                          {employee.firstName} {employee.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reviewType">Review Type</Label>
                  <Select value={newReview.reviewType} onValueChange={(value) => setNewReview({...newReview, reviewType: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select review type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="annual">Annual Review</SelectItem>
                      <SelectItem value="mid_year">Mid-Year Review</SelectItem>
                      <SelectItem value="quarterly">Quarterly Review</SelectItem>
                      <SelectItem value="probation">Probation Review</SelectItem>
                      <SelectItem value="360">360 Review</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="periodStart">Review Period Start</Label>
                  <Input
                    id="periodStart"
                    type="date"
                    value={newReview.reviewPeriodStart}
                    onChange={(e) => setNewReview({...newReview, reviewPeriodStart: e.target.value})}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="periodEnd">Review Period End</Label>
                  <Input
                    id="periodEnd"
                    type="date"
                    value={newReview.reviewPeriodEnd}
                    onChange={(e) => setNewReview({...newReview, reviewPeriodEnd: e.target.value})}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="dueDate">Due Date</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={newReview.dueDate}
                    onChange={(e) => setNewReview({...newReview, dueDate: e.target.value})}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateReviewModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleCreateReview} disabled={createReviewMutation.isPending}>
                  {createReviewMutation.isPending ? 'Creating...' : 'Create Review'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <DashboardStats />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Performance Reviews Tab */}
        <TabsContent value="reviews">
          <Card>
            <CardHeader>
              <CardTitle>Performance Reviews</CardTitle>
              <CardDescription>
                Manage employee performance reviews and assessments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingReviews ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-lg">Loading reviews...</div>
                </div>
              ) : reviews.length === 0 ? (
                <div className="text-center py-8">
                  <ClipboardCheckIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No reviews yet</h3>
                  <p className="mt-1 text-sm text-gray-500">Get started by creating a performance review.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reviews.map((review: any) => (
                    <Card key={review.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="flex-shrink-0">
                              <UserIcon className="h-8 w-8 text-gray-400" />
                            </div>
                            <div>
                              <h3 className="text-sm font-medium text-gray-900">
                                {getEmployeeName(review.employeeId)}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {review.reviewType.replace('_', ' ').toUpperCase()} Review
                              </p>
                              <p className="text-xs text-gray-400">
                                Due: {formatDate(review.dueDate)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Badge className={getStatusColor(review.status)}>
                              {review.status.replace('_', ' ').toUpperCase()}
                            </Badge>
                            {review.overallRating && (
                              <div className="flex items-center space-x-1">
                                {getRatingStars(review.overallRating)}
                              </div>
                            )}
                            <Button variant="outline" size="sm">
                              <EyeIcon className="h-4 w-4 mr-1" />
                              View
                            </Button>
                          </div>
                        </div>
                        {review.summary && (
                          <div className="mt-3 text-sm text-gray-600">
                            <strong>Summary:</strong> {review.summary}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Goals Tab */}
        <TabsContent value="goals">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Employee Goals</CardTitle>
                  <CardDescription>
                    Track and manage employee goals and objectives.
                  </CardDescription>
                </div>
                <Dialog open={isCreateGoalModalOpen} onOpenChange={setIsCreateGoalModalOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <PlusIcon className="mr-2 h-4 w-4" />
                      New Goal
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Create Employee Goal</DialogTitle>
                      <DialogDescription>
                        Set a new goal for an employee.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="goalEmployee">Employee</Label>
                        <Select value={newGoal.employeeId} onValueChange={(value) => setNewGoal({...newGoal, employeeId: value})}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select employee" />
                          </SelectTrigger>
                          <SelectContent>
                            {employees.map((employee: any) => (
                              <SelectItem key={employee.id} value={employee.id.toString()}>
                                {employee.firstName} {employee.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="goalTitle">Goal Title</Label>
                        <Input
                          id="goalTitle"
                          value={newGoal.title}
                          onChange={(e) => setNewGoal({...newGoal, title: e.target.value})}
                          placeholder="Enter goal title"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="goalDescription">Description</Label>
                        <Textarea
                          id="goalDescription"
                          value={newGoal.description}
                          onChange={(e) => setNewGoal({...newGoal, description: e.target.value})}
                          placeholder="Describe the goal in detail"
                          rows={3}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="goalCategory">Category</Label>
                        <Select value={newGoal.category} onValueChange={(value) => setNewGoal({...newGoal, category: value})}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="performance">Performance</SelectItem>
                            <SelectItem value="development">Development</SelectItem>
                            <SelectItem value="career">Career</SelectItem>
                            <SelectItem value="skill">Skill Building</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="goalStartDate">Start Date</Label>
                        <Input
                          id="goalStartDate"
                          type="date"
                          value={newGoal.startDate}
                          onChange={(e) => setNewGoal({...newGoal, startDate: e.target.value})}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="goalDueDate">Due Date</Label>
                        <Input
                          id="goalDueDate"
                          type="date"
                          value={newGoal.dueDate}
                          onChange={(e) => setNewGoal({...newGoal, dueDate: e.target.value})}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsCreateGoalModalOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="button" onClick={handleCreateGoal} disabled={createGoalMutation.isPending}>
                        {createGoalMutation.isPending ? 'Creating...' : 'Create Goal'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingGoals ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-lg">Loading goals...</div>
                </div>
              ) : goals.length === 0 ? (
                <div className="text-center py-8">
                  <TargetIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No goals set</h3>
                  <p className="mt-1 text-sm text-gray-500">Create goals to track employee performance objectives.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {goals.map((goal: any) => (
                    <Card key={goal.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <h3 className="text-sm font-medium text-gray-900">
                                {goal.title}
                              </h3>
                              <Badge variant="outline" className="text-xs">
                                {goal.category}
                              </Badge>
                              <Badge className={getStatusColor(goal.status)}>
                                {goal.status.replace('_', ' ').toUpperCase()}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-gray-600">
                              {getEmployeeName(goal.employeeId)}
                            </p>
                            <p className="mt-2 text-sm text-gray-800">
                              {goal.description}
                            </p>
                            <div className="mt-2 flex items-center text-xs text-gray-500">
                              <CalendarIcon className="h-4 w-4 mr-1" />
                              Due: {formatDate(goal.dueDate)}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button variant="outline" size="sm">
                              <EditIcon className="h-4 w-4 mr-1" />
                              Edit
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
        </TabsContent>

        {/* Feedback Tab */}
        <TabsContent value="feedback">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Employee Feedback</CardTitle>
                  <CardDescription>
                    Continuous feedback and communication records.
                  </CardDescription>
                </div>
                <Dialog open={isFeedbackModalOpen} onOpenChange={setIsFeedbackModalOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <MessageSquareIcon className="mr-2 h-4 w-4" />
                      Give Feedback
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Give Employee Feedback</DialogTitle>
                      <DialogDescription>
                        Provide feedback to help employees improve and grow.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="feedbackEmployee">Employee</Label>
                        <Select value={newFeedback.employeeId} onValueChange={(value) => setNewFeedback({...newFeedback, employeeId: value})}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select employee" />
                          </SelectTrigger>
                          <SelectContent>
                            {employees.map((employee: any) => (
                              <SelectItem key={employee.id} value={employee.id.toString()}>
                                {employee.firstName} {employee.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="feedbackType">Feedback Type</Label>
                        <Select value={newFeedback.feedbackType} onValueChange={(value) => setNewFeedback({...newFeedback, feedbackType: value})}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select feedback type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="positive">Positive</SelectItem>
                            <SelectItem value="constructive">Constructive</SelectItem>
                            <SelectItem value="recognition">Recognition</SelectItem>
                            <SelectItem value="coaching">Coaching</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="feedbackSubject">Subject</Label>
                        <Input
                          id="feedbackSubject"
                          value={newFeedback.subject}
                          onChange={(e) => setNewFeedback({...newFeedback, subject: e.target.value})}
                          placeholder="Brief subject of the feedback"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="feedbackContent">Feedback</Label>
                        <Textarea
                          id="feedbackContent"
                          value={newFeedback.content}
                          onChange={(e) => setNewFeedback({...newFeedback, content: e.target.value})}
                          placeholder="Detailed feedback content"
                          rows={4}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsFeedbackModalOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="button" onClick={handleCreateFeedback} disabled={createFeedbackMutation.isPending}>
                        {createFeedbackMutation.isPending ? 'Submitting...' : 'Submit Feedback'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingFeedback ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-lg">Loading feedback...</div>
                </div>
              ) : feedback.length === 0 ? (
                <div className="text-center py-8">
                  <MessageSquareIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No feedback yet</h3>
                  <p className="mt-1 text-sm text-gray-500">Start giving feedback to help employees grow.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {feedback.map((item: any) => (
                    <Card key={item.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <h3 className="text-sm font-medium text-gray-900">
                                {item.subject}
                              </h3>
                              <Badge variant="outline" className="text-xs">
                                {item.feedbackType}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-gray-600">
                              To: {getEmployeeName(item.employeeId)}
                            </p>
                            <p className="mt-2 text-sm text-gray-800">
                              {item.content}
                            </p>
                            <div className="mt-2 flex items-center text-xs text-gray-500">
                              <CalendarIcon className="h-4 w-4 mr-1" />
                              {getTimeAgo(item.createdAt)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics">
          <Card>
            <CardHeader>
              <CardTitle>Performance Analytics</CardTitle>
              <CardDescription>
                Insights and trends across your organization's performance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                {/* Performance Trends */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Performance Trends</h3>
                  {dashboardStats?.performanceTrends ? (
                    <div className="space-y-3">
                      {dashboardStats.performanceTrends.map((trend: any, index: number) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">{trend.category}</p>
                            <p className="text-sm text-gray-600">Average Score: {trend.score}%</p>
                          </div>
                          <div className="flex items-center">
                            <span className={`text-sm font-medium ${trend.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {trend.change === null ? 'No prior comparison' : `${trend.change >= 0 ? '+' : ''}${trend.change}%`}
                            </span>
                            <TrendingUpIcon className={`ml-1 h-4 w-4 ${trend.change >= 0 ? 'text-green-600' : 'text-red-600'}`} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      No performance trends data available yet
                    </div>
                  )}
                </div>
                
                {/* Quick Stats */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Quick Statistics</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        {reviews.filter((r: any) => r.status === 'completed').length || 0}
                      </div>
                      <p className="text-sm text-blue-800">Completed Reviews</p>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        {goals.filter((g: any) => g.status === 'completed').length || 0}
                      </div>
                      <p className="text-sm text-green-800">Completed Goals</p>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600">
                        {feedback.filter((f: any) => f.feedbackType === 'positive').length || 0}
                      </div>
                      <p className="text-sm text-purple-800">Positive Feedback</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PerformanceOverview;