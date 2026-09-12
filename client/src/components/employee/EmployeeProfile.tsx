import type { ApiEmployee, ApiDocument } from '@/lib/api-types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDate, getStatusClass } from "@/lib/utils";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AddEditEmployeeModal from "./AddEditEmployeeModal";

interface EmployeeProfileProps {
  employeeId: number;
  onClose: () => void;
}

export default function EmployeeProfile({ employeeId, onClose }: EmployeeProfileProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Fetch employee data
  const { data: employee, isLoading, error, refetch } = useQuery<ApiEmployee>({
    queryKey: [`/api/employees/${employeeId}`],
    staleTime: 1000 * 60, // 1 minute
  });

  // Fetch employee documents
  const { data: documents } = useQuery<ApiDocument[]>({
    queryKey: [`/api/employees/${employeeId}/documents`],
    staleTime: 1000 * 60, // 1 minute
    enabled: !!employeeId,
  });

  // Placeholder avatar fallback text
  const getAvatarText = (firstName: string, lastName: string) => {
    return (firstName?.charAt(0) || "") + (lastName?.charAt(0) || "");
  };

  // Format employee status
  const formatEmployeeStatus = (status: string) => {
    return status?.replace("_", " ").replace(/\\b\\w/g, (l: string) => l.toUpperCase());
  };

  // If loading employee data
  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-center">
            <p>Loading employee details...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // If error fetching employee data
  if (error || !employee) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center">
            <p className="text-error mb-4">Error loading employee details</p>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // This is sample data - in a real application, this would come from the API
  const employeeDocuments = documents || [];

  return (
    <>
      <Card className="mb-8">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex items-center space-x-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={employee.photo ?? undefined} alt={employee.firstName} />
              <AvatarFallback className="text-lg">{getAvatarText(employee.firstName, employee.lastName)}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-xl">{employee.firstName} {employee.lastName}</CardTitle>
              <CardDescription className="text-sm">{employee.position}</CardDescription>
              <div className="flex space-x-2 mt-1">
                <Badge variant="outline" className={getStatusClass(employee.status)}>
                  {formatEmployeeStatus(employee.status)}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {employee.type}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" onClick={onClose}>
              <i className="fas fa-times mr-2"></i> Close
            </Button>
            <Button onClick={() => setShowEditModal(true)}>
              <i className="fas fa-edit mr-2"></i> Edit
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="personal">Personal Info</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Employee Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Employee ID</dt>
                    <dd>{employee.employeeId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Department</dt>
                    <dd>{employee.department}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Position</dt>
                    <dd>{employee.position}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Status</dt>
                    <dd>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(employee.status)}`}>
                        {formatEmployeeStatus(employee.status)}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Join Date</dt>
                    <dd>{formatDate(employee.joiningDate)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Information</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Mobile</dt>
                    <dd>{employee.primaryMobile || "-"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Work Email</dt>
                    <dd>{employee.workEmail || "-"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">Personal Email</dt>
                    <dd>{employee.personalEmail || "-"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium text-neutral-500">QID Number</dt>
                    <dd>{employee.qidNumber || "-"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documents Status</CardTitle>
              </CardHeader>
              <CardContent>
                {employeeDocuments.length > 0 ? (
                  <div className="space-y-4">
                    {employeeDocuments.slice(0, 3).map((doc: any) => (
                      <div key={doc.id} className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">{doc.documentType}</p>
                          <p className="text-sm text-neutral-500">Expiry: {formatDate(doc.expiryDate)}</p>
                        </div>
                        <Badge className={getStatusClass(doc.status)}>
                          {doc.status.replace("_", " ")}
                        </Badge>
                      </div>
                    ))}
                    {employeeDocuments.length > 3 && (
                      <Button 
                        variant="link" 
                        onClick={() => setActiveTab("documents")}
                        className="p-0 h-auto text-primary"
                      >
                        View {employeeDocuments.length - 3} more documents
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-neutral-500">No documents found</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Personal Info Tab */}
        <TabsContent value="personal" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Full Name (English)</p>
                  <p>{employee.firstName} {employee.lastName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Full Name (Arabic)</p>
                  <p dir="rtl">{employee.fullNameArabic || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Gender</p>
                  <p className="capitalize">{employee.gender || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Date of Birth</p>
                  <p>{employee.dateOfBirth ? formatDate(employee.dateOfBirth) : "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Nationality</p>
                  <p className="capitalize">{employee.nationality || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">QID Number</p>
                  <p>{employee.qidNumber || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Marital Status</p>
                  <p className="capitalize">{employee.maritalStatus?.replace("_", " ") || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Religion</p>
                  <p className="capitalize">{employee.religion?.replace("_", " ") || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Blood Group</p>
                  <p>{employee.bloodGroup?.replace("_positive", "+").replace("_negative", "-").toUpperCase() || "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Primary Mobile</p>
                  <p>{employee.primaryMobile || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Secondary Contact</p>
                  <p>{employee.secondaryContact || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Personal Email</p>
                  <p>{employee.personalEmail || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Work Email</p>
                  <p>{employee.workEmail || "-"}</p>
                </div>
                <div className="md:col-span-2 space-y-1">
                  <p className="text-sm text-neutral-500">Residential Address</p>
                  <p>{employee.residentialAddress || "-"}</p>
                </div>
                <div className="md:col-span-2 space-y-1">
                  <p className="text-sm text-neutral-500">Home Country Address</p>
                  <p>{employee.homeCountryAddress || "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Emergency Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Name</p>
                  <p>{employee.emergencyContactName || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Contact Number</p>
                  <p>{employee.emergencyContactNumber || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Relationship</p>
                  <p>{employee.emergencyContactRelation || "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Employment Tab */}
        <TabsContent value="employment" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employment Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Employee ID</p>
                  <p>{employee.employeeId || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Employment Type</p>
                  <p className="capitalize">{employee.type || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Department</p>
                  <p>{employee.department || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Position</p>
                  <p>{employee.position || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Location</p>
                  <p>{employee.location || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Work Location</p>
                  <p>{employee.workLocation || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Employee Category</p>
                  <p className="capitalize">{employee.employeeCategory || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Job Grade</p>
                  <p>{employee.jobGrade || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Cost Center</p>
                  <p>{employee.costCenter || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Event Staff Eligible</p>
                  <p>{employee.eventStaffEligible ? "Yes" : "No"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contract Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Joining Date</p>
                  <p>{formatDate(employee.joiningDate) || "-"}</p>
                </div>
                {employee.type !== "permanent" && (
                  <div className="space-y-1">
                    <p className="text-sm text-neutral-500">Contract End Date</p>
                    <p>{employee.contractEndDate ? formatDate(employee.contractEndDate) : "-"}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Status</p>
                  <p>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(employee.status)}`}>
                      {formatEmployeeStatus(employee.status)}
                    </span>
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Probation Period</p>
                  <p>{employee.probationPeriod ? `${employee.probationPeriod} months` : "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Notice Period</p>
                  <p>{employee.noticePeriod ? `${employee.noticePeriod} days` : "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Banking Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Bank Name</p>
                  <p>{employee.bankName || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Account Name</p>
                  <p>{employee.accountName || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">IBAN Number</p>
                  <p>{employee.ibanNumber || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Swift Code</p>
                  <p>{employee.swiftCode || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-neutral-500">Bank Branch</p>
                  <p>{employee.bankBranch || "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Employee Documents</CardTitle>
              <Button size="sm">
                <i className="fas fa-file-upload mr-2"></i> Add Document
              </Button>
            </CardHeader>
            <CardContent>
              {employeeDocuments.length > 0 ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-neutral-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Document Type</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Document Number</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Issue Date</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Expiry Date</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-neutral-200">
                        {employeeDocuments.map((doc: any) => (
                          <tr key={doc.id}>
                            <td className="px-4 py-3 text-sm">{doc.documentType}</td>
                            <td className="px-4 py-3 text-sm">{doc.documentNumber}</td>
                            <td className="px-4 py-3 text-sm">{formatDate(doc.issueDate)}</td>
                            <td className="px-4 py-3 text-sm">{formatDate(doc.expiryDate)}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(doc.status)}`}>
                                {doc.status.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-right space-x-2">
                              <button className="text-primary hover:text-primary-dark">
                                <i className="fas fa-download"></i>
                              </button>
                              <button className="text-neutral-500 hover:text-neutral-700">
                                <i className="fas fa-eye"></i>
                              </button>
                              <button className="text-neutral-500 hover:text-neutral-700">
                                <i className="fas fa-edit"></i>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-neutral-500 mb-4">No documents have been added for this employee</p>
                  <Button>
                    <i className="fas fa-file-upload mr-2"></i> Add First Document
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="space-y-4">
                  <p className="text-neutral-500 text-center">Activity history will be shown here</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Employee Modal */}
      <AddEditEmployeeModal 
        open={showEditModal} 
        onOpenChange={setShowEditModal} 
        employee={employee}
        onSuccess={() => {
          refetch();
          setShowEditModal(false);
        }}
      />
    </>
  );
}