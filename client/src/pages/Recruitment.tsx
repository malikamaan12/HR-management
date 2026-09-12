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
import { 
  PlusCircle, 
  Search, 
  BriefcaseBusiness, 
  UserPlus, 
  Calendar, 
  ClipboardList,
  Check,
  X,
  Eye,
  Edit
} from "lucide-react";
import { JobRequisitionModal } from "@/components/recruitment/JobRequisitionModal";
import { CandidateModal } from "@/components/recruitment/CandidateModal";

// Type definitions for our entities
type JobRequisition = {
  id: number;
  requisitionId: string;
  jobTitle: string;
  department: string;
  location: string;
  positionType: string;
  numberOfVacancies: number;
  status: string;
  postingStartDate: string | null;
  postingEndDate: string | null;
  createdAt: string;
};

type Candidate = {
  id: number;
  fullNameEn: string;
  email: string;
  phone: string;
  source: string;
  createdAt: string;
};

type JobApplication = {
  id: number;
  candidateId: number;
  requisitionId: number;
  applicationDate: string;
  status: string;
  candidateName: string; // Joined from Candidate
  jobTitle: string; // Joined from JobRequisition
};

type Interview = {
  id: number;
  applicationId: number;
  interviewerId: number;
  interviewDate: string;
  interviewRound: string;
  status: string;
  candidateName: string; // Joined from Candidate
  jobTitle: string; // Joined from JobRequisition
  interviewerName: string; // Joined from Employee
};

type JobOffer = {
  id: number;
  applicationId: number;
  offerDate: string;
  startDate: string | null;
  status: string;
  candidateName: string; // Joined from Candidate
  jobTitle: string; // Joined from JobRequisition
};

export default function Recruitment() {
  const [activeTab, setActiveTab] = useState("requisitions");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // Modal states
  const [isJobRequisitionModalOpen, setIsJobRequisitionModalOpen] = useState(false);
  const [isCandidateModalOpen, setIsCandidateModalOpen] = useState(false);
  const [selectedRequisition, setSelectedRequisition] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // Fetch job requisitions
  const { 
    data: jobRequisitions = [], 
    isLoading: isLoadingRequisitions 
  } = useQuery<JobRequisition[]>({
    queryKey: ['/api/job-requisitions'],
    enabled: activeTab === "requisitions",
  });
  
  // Fetch candidates
  const { 
    data: candidates = [], 
    isLoading: isLoadingCandidates 
  } = useQuery<Candidate[]>({
    queryKey: ['/api/candidates'],
    enabled: activeTab === "candidates",
  });
  
  // Fetch applications
  const { 
    data: applications = [], 
    isLoading: isLoadingApplications 
  } = useQuery<JobApplication[]>({
    queryKey: ['/api/job-applications'],
    enabled: activeTab === "applications",
  });
  
  // Fetch interviews
  const { 
    data: interviews = [], 
    isLoading: isLoadingInterviews 
  } = useQuery<Interview[]>({
    queryKey: ['/api/interviews'],
    enabled: activeTab === "interviews",
  });
  
  // Fetch offers
  const { 
    data: offers = [], 
    isLoading: isLoadingOffers 
  } = useQuery<JobOffer[]>({
    queryKey: ['/api/job-offers'],
    enabled: activeTab === "offers",
  });

  // Filter function
  const filterItems = <T extends { [key: string]: any }>(
    items: T[],
    query: string,
    status: string,
    statusKey: string = 'status'
  ): T[] => {
    return items.filter((item) => {
      // Filter by search query
      const matchesQuery = Object.values(item).some(
        (value) => 
          typeof value === 'string' && 
          value.toLowerCase().includes(query.toLowerCase())
      );
      
      // Filter by status
      const matchesStatus = status === 'all' || item[statusKey] === status;
      
      return matchesQuery && matchesStatus;
    });
  };

  // Get filtered items for each tab
  const filteredRequisitions = filterItems(jobRequisitions, searchQuery, statusFilter);
  const filteredCandidates = filterItems(candidates, searchQuery, 'all');
  const filteredApplications = filterItems(applications, searchQuery, statusFilter);
  const filteredInterviews = filterItems(interviews, searchQuery, statusFilter);
  const filteredOffers = filterItems(offers, searchQuery, statusFilter);

  // Generate status badge
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: string; label: string }> = {
      draft: { variant: "secondary", label: "Draft" },
      pending_approval: { variant: "warning", label: "Pending Approval" },
      approved: { variant: "default", label: "Approved" },
      open: { variant: "success", label: "Open" },
      on_hold: { variant: "outline", label: "On Hold" },
      closed: { variant: "destructive", label: "Closed" },
      new: { variant: "secondary", label: "New" },
      screening: { variant: "default", label: "Screening" },
      shortlisted: { variant: "default", label: "Shortlisted" },
      interview: { variant: "warning", label: "Interview" },
      offer: { variant: "success", label: "Offer" },
      hired: { variant: "success", label: "Hired" },
      rejected: { variant: "destructive", label: "Rejected" },
      scheduled: { variant: "warning", label: "Scheduled" },
      completed: { variant: "success", label: "Completed" },
      cancelled: { variant: "destructive", label: "Cancelled" },
      no_show: { variant: "destructive", label: "No Show" },
      pending: { variant: "warning", label: "Pending" },
      accepted: { variant: "success", label: "Accepted" },
      declined: { variant: "destructive", label: "Declined" },
      expired: { variant: "destructive", label: "Expired" }
    };
    
    const config = statusConfig[status] || { variant: "secondary", label: status };
    
    return (
      <Badge variant={config.variant as any}>{config.label}</Badge>
    );
  };

  // Handle modal actions
  const handleCreateRequisition = () => {
    setSelectedRequisition(null);
    setIsEditing(false);
    setIsJobRequisitionModalOpen(true);
  };

  const handleEditRequisition = (requisition: any) => {
    setSelectedRequisition(requisition);
    setIsEditing(true);
    setIsJobRequisitionModalOpen(true);
  };

  const handleCreateCandidate = () => {
    setSelectedCandidate(null);
    setIsEditing(false);
    setIsCandidateModalOpen(true);
  };

  const handleEditCandidate = (candidate: any) => {
    setSelectedCandidate(candidate);
    setIsEditing(true);
    setIsCandidateModalOpen(true);
  };

  return (
    <div className="container p-6 mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Recruitment Management</h1>
        <div className="flex space-x-2">
          {activeTab === "requisitions" && (
            <Button onClick={handleCreateRequisition}>
              <PlusCircle className="mr-2 h-4 w-4" />
              New Job Requisition
            </Button>
          )}
          {activeTab === "candidates" && (
            <Button onClick={handleCreateCandidate}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Candidate
            </Button>
          )}
        </div>
      </div>

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
              {/* Dynamic status options based on active tab */}
              {activeTab === "requisitions" && (
                <>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending_approval">Pending Approval</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </>
              )}
              {activeTab === "applications" && (
                <>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="screening">Screening</SelectItem>
                  <SelectItem value="shortlisted">Shortlisted</SelectItem>
                  <SelectItem value="interview">Interview</SelectItem>
                  <SelectItem value="offer">Offer</SelectItem>
                  <SelectItem value="hired">Hired</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </>
              )}
              {activeTab === "interviews" && (
                <>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No Show</SelectItem>
                </>
              )}
              {activeTab === "offers" && (
                <>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-5 mb-8">
          <TabsTrigger value="requisitions" className="flex items-center">
            <BriefcaseBusiness className="mr-2 h-4 w-4" />
            Job Requisitions
          </TabsTrigger>
          <TabsTrigger value="candidates" className="flex items-center">
            <UserPlus className="mr-2 h-4 w-4" />
            Candidates
          </TabsTrigger>
          <TabsTrigger value="applications" className="flex items-center">
            <ClipboardList className="mr-2 h-4 w-4" />
            Applications
          </TabsTrigger>
          <TabsTrigger value="interviews" className="flex items-center">
            <Calendar className="mr-2 h-4 w-4" />
            Interviews
          </TabsTrigger>
          <TabsTrigger value="offers" className="flex items-center">
            <Check className="mr-2 h-4 w-4" />
            Offers
          </TabsTrigger>
        </TabsList>

        {/* Job Requisitions Tab */}
        <TabsContent value="requisitions">
          <Card>
            <CardHeader>
              <CardTitle>Job Requisitions</CardTitle>
              <CardDescription>
                Manage job requisitions, review pending requests, and create new openings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingRequisitions ? (
                <div className="flex justify-center p-6">Loading...</div>
              ) : filteredRequisitions.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Job Title</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Vacancies</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequisitions.map((req) => (
                      <TableRow key={req.id}>
                        <TableCell>{req.requisitionId}</TableCell>
                        <TableCell className="font-medium">{req.jobTitle}</TableCell>
                        <TableCell>{req.department}</TableCell>
                        <TableCell>{req.location}</TableCell>
                        <TableCell>{req.positionType}</TableCell>
                        <TableCell>{req.numberOfVacancies}</TableCell>
                        <TableCell>{getStatusBadge(req.status)}</TableCell>
                        <TableCell>{new Date(req.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleEditRequisition(req)}>
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
                  <BriefcaseBusiness className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No job requisitions found</p>
                  <Button size="sm" onClick={handleCreateRequisition}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Create Job Requisition
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Candidates Tab */}
        <TabsContent value="candidates">
          <Card>
            <CardHeader>
              <CardTitle>Candidates</CardTitle>
              <CardDescription>
                View and manage candidate profiles in your talent pool.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingCandidates ? (
                <div className="flex justify-center p-6">Loading...</div>
              ) : filteredCandidates.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Added On</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCandidates.map((candidate) => (
                      <TableRow key={candidate.id}>
                        <TableCell className="font-medium">{candidate.fullNameEn}</TableCell>
                        <TableCell>{candidate.email}</TableCell>
                        <TableCell>{candidate.phone}</TableCell>
                        <TableCell>{candidate.source}</TableCell>
                        <TableCell>{new Date(candidate.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleEditCandidate(candidate)}>
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
                  <UserPlus className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No candidates found</p>
                  <Button size="sm" onClick={handleCreateCandidate}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Candidate
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Applications Tab */}
        <TabsContent value="applications">
          <Card>
            <CardHeader>
              <CardTitle>Job Applications</CardTitle>
              <CardDescription>
                Track and manage job applications for all positions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingApplications ? (
                <div className="flex justify-center p-6">Loading...</div>
              ) : filteredApplications.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Application Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredApplications.map((app) => (
                      <TableRow key={app.id}>
                        <TableCell className="font-medium">{app.candidateName}</TableCell>
                        <TableCell>{app.jobTitle}</TableCell>
                        <TableCell>{new Date(app.applicationDate).toLocaleDateString()}</TableCell>
                        <TableCell>{getStatusBadge(app.status)}</TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">View</Button>
                            <Button variant="outline" size="sm">Schedule</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center p-6">
                  <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No applications found</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Interviews Tab */}
        <TabsContent value="interviews">
          <Card>
            <CardHeader>
              <CardTitle>Interviews</CardTitle>
              <CardDescription>
                Manage interview schedules and view interview feedback.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingInterviews ? (
                <div className="flex justify-center p-6">Loading...</div>
              ) : filteredInterviews.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Interviewer</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Round</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInterviews.map((interview) => (
                      <TableRow key={interview.id}>
                        <TableCell className="font-medium">{interview.candidateName}</TableCell>
                        <TableCell>{interview.jobTitle}</TableCell>
                        <TableCell>{interview.interviewerName}</TableCell>
                        <TableCell>{new Date(interview.interviewDate).toLocaleString()}</TableCell>
                        <TableCell>{interview.interviewRound}</TableCell>
                        <TableCell>{getStatusBadge(interview.status)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm">View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center p-6">
                  <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No interviews scheduled</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Offers Tab */}
        <TabsContent value="offers">
          <Card>
            <CardHeader>
              <CardTitle>Job Offers</CardTitle>
              <CardDescription>
                Manage job offers and track candidate responses.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOffers ? (
                <div className="flex justify-center p-6">Loading...</div>
              ) : filteredOffers.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Offer Date</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOffers.map((offer) => (
                      <TableRow key={offer.id}>
                        <TableCell className="font-medium">{offer.candidateName}</TableCell>
                        <TableCell>{offer.jobTitle}</TableCell>
                        <TableCell>{new Date(offer.offerDate).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {offer.startDate ? new Date(offer.startDate).toLocaleDateString() : '-'}
                        </TableCell>
                        <TableCell>{getStatusBadge(offer.status)}</TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">View</Button>
                            {offer.status === "accepted" && (
                              <Button variant="outline" size="sm">Onboard</Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center p-6">
                  <Check className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No job offers found</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <JobRequisitionModal
        isOpen={isJobRequisitionModalOpen}
        onClose={() => setIsJobRequisitionModalOpen(false)}
        requisition={selectedRequisition}
        isEditing={isEditing}
      />

      <CandidateModal
        isOpen={isCandidateModalOpen}
        onClose={() => setIsCandidateModalOpen(false)}
        candidate={selectedCandidate}
        isEditing={isEditing}
      />
    </div>
  );
}