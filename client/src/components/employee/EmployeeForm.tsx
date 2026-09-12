import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { insertEmployeeSchema } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  employeeId: z.string().min(1, { message: "Employee ID is required" }),
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  fullNameArabic: z.string().min(1, { message: "Arabic name is required" }),
  gender: z.enum(["male", "female", "other"]),
  dateOfBirth: z.date({ required_error: "Date of birth is required" }),
  nationality: z.string().min(1, { message: "Nationality is required" }),
  qidNumber: z.string().min(8, { message: "QID number must be at least 8 characters" }),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed"]).optional(),
  religion: z.enum(["islam", "christianity", "hinduism", "buddhism", "other"]),
  bloodGroup: z.enum(["a_positive", "a_negative", "b_positive", "b_negative", "ab_positive", "ab_negative", "o_positive", "o_negative"]).optional(),
  primaryMobile: z.string().min(8, { message: "Phone number must be at least 8 characters" }),
  secondaryContact: z.string().optional(),
  personalEmail: z.string().email().optional().or(z.literal("")),
  residentialAddress: z.string().min(1, { message: "Residential address is required" }),
  homeCountryAddress: z.string().optional(),
  emergencyContactName: z.string().min(1, { message: "Emergency contact name is required" }),
  emergencyContactNumber: z.string().min(8, { message: "Emergency contact number is required" }),
  emergencyContactRelation: z.string().optional(),
  type: z.enum(["permanent", "temporary", "contract"]),
  eventStaffEligible: z.boolean().default(false),
  department: z.string().min(1, { message: "Department is required" }),
  position: z.string().min(1, { message: "Position is required" }),
  location: z.string().min(1, { message: "Location is required" }),
  reportingManagerId: z.number().optional(),
  secondaryManagerId: z.number().optional(),
  joiningDate: z.date({ required_error: "Joining date is required" }),
  contractEndDate: z.date().optional(),
  workLocation: z.string().optional(),
  workEmail: z.string().email().optional().or(z.literal("")),
  workPhone: z.string().optional(),
  costCenter: z.string().optional(),
  employeeCategory: z.enum(["expatriate", "national"]),
  jobGrade: z.string().optional(),
  probationPeriod: z.number().optional(),
  noticePeriod: z.number().optional(),
  bankName: z.string().optional(),
  ibanNumber: z.string().optional(),
  swiftCode: z.string().optional(),
  bankBranch: z.string().optional(),
  accountName: z.string().optional(),
  status: z.enum(["active", "inactive", "on_leave"]),
});

// Additional helper schemas for dropdowns
const countries = [
  "Qatar", "India", "Pakistan", "Bangladesh", "Nepal", "Philippines", "Egypt", 
  "United Kingdom", "United States", "Canada", "Australia"
];

const departments = [
  "Human Resources", "Finance", "IT", "Operations", "Marketing", "Sales", 
  "Events", "Administration", "Legal", "Executive"
];

const positions = [
  "Manager", "Assistant Manager", "Coordinator", "Administrator", "Director",
  "Officer", "Specialist", "Analyst", "Developer", "Designer"
];

const religions = [
  "Islam", "Christianity", "Hinduism", "Buddhism", "Other"
];

const bloodGroups = [
  "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"
];

const qatarBanks = [
  "Qatar National Bank (QNB)", "Commercial Bank", "Doha Bank", "Al Khalij Commercial Bank", 
  "Qatar Islamic Bank", "Qatar International Islamic Bank", "Masraf Al Rayan", 
  "Ahli Bank", "HSBC Qatar", "Standard Chartered Qatar"
];

export default function EmployeeForm({ employee, onSuccess }: { employee?: any, onSuccess: () => void }) {
  const [activeTab, setActiveTab] = useState("personal");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Initialize form with default values or existing employee data
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: employee ? {
      employeeId: employee.employeeId || "",
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      fullNameArabic: employee.fullNameArabic || "",
      gender: employee.gender || "male",
      dateOfBirth: employee.dateOfBirth ? new Date(employee.dateOfBirth) : undefined,
      nationality: employee.nationality || "",
      qidNumber: employee.qidNumber || "",
      maritalStatus: employee.maritalStatus || "single",
      religion: employee.religion || "islam",
      bloodGroup: employee.bloodGroup || undefined,
      primaryMobile: employee.primaryMobile || "",
      secondaryContact: employee.secondaryContact || "",
      personalEmail: employee.personalEmail || "",
      residentialAddress: employee.residentialAddress || "",
      homeCountryAddress: employee.homeCountryAddress || "",
      emergencyContactName: employee.emergencyContactName || "",
      emergencyContactNumber: employee.emergencyContactNumber || "",
      emergencyContactRelation: employee.emergencyContactRelation || "",
      type: employee.type || "permanent",
      eventStaffEligible: employee.eventStaffEligible || false,
      department: employee.department || "",
      position: employee.position || "",
      location: employee.location || "Doha",
      reportingManagerId: employee.reportingManagerId || undefined,
      secondaryManagerId: employee.secondaryManagerId || undefined,
      joiningDate: employee.joiningDate ? new Date(employee.joiningDate) : new Date(),
      contractEndDate: employee.contractEndDate ? new Date(employee.contractEndDate) : undefined,
      workLocation: employee.workLocation || "",
      workEmail: employee.workEmail || "",
      workPhone: employee.workPhone || "",
      costCenter: employee.costCenter || "",
      employeeCategory: employee.employeeCategory || "expatriate",
      jobGrade: employee.jobGrade || "",
      probationPeriod: employee.probationPeriod || 3,
      noticePeriod: employee.noticePeriod || 30,
      bankName: employee.bankName || "",
      ibanNumber: employee.ibanNumber || "",
      swiftCode: employee.swiftCode || "",
      bankBranch: employee.bankBranch || "",
      accountName: employee.accountName || "",
      status: employee.status || "active",
    } : {
      employeeId: "",
      firstName: "",
      lastName: "",
      fullNameArabic: "",
      gender: "male",
      dateOfBirth: undefined,
      nationality: "Qatar",
      qidNumber: "",
      maritalStatus: "single",
      religion: "islam",
      bloodGroup: undefined,
      primaryMobile: "",
      secondaryContact: "",
      personalEmail: "",
      residentialAddress: "",
      homeCountryAddress: "",
      emergencyContactName: "",
      emergencyContactNumber: "",
      emergencyContactRelation: "",
      type: "permanent",
      eventStaffEligible: false,
      department: "",
      position: "",
      location: "Doha",
      reportingManagerId: undefined,
      secondaryManagerId: undefined,
      joiningDate: new Date(),
      contractEndDate: undefined,
      workLocation: "",
      workEmail: "",
      workPhone: "",
      costCenter: "",
      employeeCategory: "expatriate",
      jobGrade: "",
      probationPeriod: 3,
      noticePeriod: 30,
      bankName: "",
      ibanNumber: "",
      swiftCode: "",
      bankBranch: "",
      accountName: "",
      status: "active",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      const url = employee ? `/api/employees/${employee.id}` : "/api/employees";
      const method = employee ? "PATCH" : "POST";
      
      // Convert dates to ISO strings for API
      const formattedValues = {
        ...values,
        dateOfBirth: values.dateOfBirth?.toISOString().split('T')[0],
        joiningDate: values.joiningDate?.toISOString().split('T')[0],
        contractEndDate: values.contractEndDate?.toISOString().split('T')[0],
        // Handle optional fields properly
        secondaryContact: values.secondaryContact || null,
        personalEmail: values.personalEmail || null,
        homeCountryAddress: values.homeCountryAddress || null,
        emergencyContactRelation: values.emergencyContactRelation || null,
        workLocation: values.workLocation || null,
        workEmail: values.workEmail || null,
        workPhone: values.workPhone || null,
        costCenter: values.costCenter || null,
        jobGrade: values.jobGrade || null,
        bankName: values.bankName || null,
        ibanNumber: values.ibanNumber || null,
        swiftCode: values.swiftCode || null,
        bankBranch: values.bankBranch || null,
        accountName: values.accountName || null,
      };
      
      const response = await apiRequest({
        url,
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formattedValues),
      });
      
      // Success
      toast({
        title: employee ? "Employee Updated" : "Employee Added",
        description: `${values.firstName} ${values.lastName} has been ${employee ? "updated" : "added"} successfully.`,
      });
      
      // Invalidate the employees query to refetch the data
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("Error saving employee:", error);
      toast({
        title: "Error",
        description: "There was a problem saving the employee data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{employee ? "Edit Employee" : "Add New Employee"}</CardTitle>
            <CardDescription>
              {employee 
                ? "Update employee information in the system" 
                : "Enter employee details to add them to the system"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="personal" onValueChange={setActiveTab} value={activeTab}>
              <TabsList className="grid grid-cols-3 mb-6">
                <TabsTrigger value="personal">Personal Information</TabsTrigger>
                <TabsTrigger value="employment">Employment Details</TabsTrigger>
                <TabsTrigger value="bank">Bank & Emergency Details</TabsTrigger>
              </TabsList>

              {/* Personal Information Tab */}
              <TabsContent value="personal" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Employee ID */}
                  <FormField
                    control={form.control}
                    name="employeeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employee ID *</FormLabel>
                        <FormControl>
                          <Input placeholder="EMP-001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* First Name */}
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="First name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Last Name */}
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Last name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Arabic Name */}
                  <FormField
                    control={form.control}
                    name="fullNameArabic"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name (Arabic) *</FormLabel>
                        <FormControl>
                          <Input placeholder="الاسم الكامل" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* QID Number */}
                  <FormField
                    control={form.control}
                    name="qidNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>QID Number *</FormLabel>
                        <FormControl>
                          <Input placeholder="Qatar ID Number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Gender */}
                  <FormField
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>Gender *</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-row space-x-4"
                          >
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="male" />
                              </FormControl>
                              <FormLabel className="font-normal">
                                Male
                              </FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="female" />
                              </FormControl>
                              <FormLabel className="font-normal">
                                Female
                              </FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="other" />
                              </FormControl>
                              <FormLabel className="font-normal">
                                Other
                              </FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Date of Birth */}
                  <FormField
                    control={form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Date of Birth *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? (
                                  format(new Date(field.value), "PPP")
                                ) : (
                                  <span>Pick a date</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value ? new Date(field.value) : undefined}
                              onSelect={field.onChange}
                              disabled={(date) =>
                                date > new Date() || date < new Date("1940-01-01")
                              }
                              defaultMonth={field.value ? new Date(field.value) : new Date(1990, 0, 1)}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Nationality */}
                  <FormField
                    control={form.control}
                    name="nationality"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nationality *</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select nationality" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {countries.map((country) => (
                              <SelectItem key={country} value={country.toLowerCase()}>
                                {country}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Marital Status */}
                  <FormField
                    control={form.control}
                    name="maritalStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marital Status</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          defaultValue={field.value || "single"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="single">Single</SelectItem>
                            <SelectItem value="married">Married</SelectItem>
                            <SelectItem value="divorced">Divorced</SelectItem>
                            <SelectItem value="widowed">Widowed</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Religion */}
                  <FormField
                    control={form.control}
                    name="religion"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Religion *</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          defaultValue={field.value || "islam"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select religion" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {religions.map((religion) => (
                              <SelectItem key={religion} value={religion.toLowerCase()}>
                                {religion}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Blood Group */}
                  <FormField
                    control={form.control}
                    name="bloodGroup"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Blood Group</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select blood group" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {bloodGroups.map((group) => (
                              <SelectItem 
                                key={group} 
                                value={group.replace("+", "_positive").replace("-", "_negative").toLowerCase()}
                              >
                                {group}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Primary Mobile */}
                  <FormField
                    control={form.control}
                    name="primaryMobile"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary Mobile *</FormLabel>
                        <FormControl>
                          <Input placeholder="+974 XXXX XXXX" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Secondary Contact */}
                  <FormField
                    control={form.control}
                    name="secondaryContact"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secondary Contact</FormLabel>
                        <FormControl>
                          <Input placeholder="+974 XXXX XXXX" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Personal Email */}
                  <FormField
                    control={form.control}
                    name="personalEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Personal Email</FormLabel>
                        <FormControl>
                          <Input placeholder="email@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Residential Address */}
                  <FormField
                    control={form.control}
                    name="residentialAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Residential Address in Qatar *</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Home Country Address */}
                  <FormField
                    control={form.control}
                    name="homeCountryAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Home Country Address</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-between">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                  <Button 
                    type="button" 
                    onClick={() => setActiveTab("employment")}
                  >
                    Next: Employment Details
                  </Button>
                </div>
              </TabsContent>

              {/* Employment Details Tab */}
              <TabsContent value="employment" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Employment Type */}
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employment Type *</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="permanent">Permanent</SelectItem>
                            <SelectItem value="temporary">Temporary</SelectItem>
                            <SelectItem value="contract">Contract</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Event Staff Eligibility */}
                  <FormField
                    control={form.control}
                    name="eventStaffEligible"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-8">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            Eligible for Event Staffing
                          </FormLabel>
                          <FormDescription>
                            Can be assigned to event staff roles
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                  
                  {/* Employee Category */}
                  <FormField
                    control={form.control}
                    name="employeeCategory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employee Category *</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="expatriate">Expatriate</SelectItem>
                            <SelectItem value="national">National</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Department */}
                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Department *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select department" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {departments.map((dept) => (
                              <SelectItem key={dept} value={dept}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Position */}
                  <FormField
                    control={form.control}
                    name="position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select position" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {positions.map((pos) => (
                              <SelectItem key={pos} value={pos}>
                                {pos}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Job Grade */}
                  <FormField
                    control={form.control}
                    name="jobGrade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Grade</FormLabel>
                        <FormControl>
                          <Input placeholder="Job Grade" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Location */}
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location *</FormLabel>
                        <FormControl>
                          <Input placeholder="Location" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Work Location */}
                  <FormField
                    control={form.control}
                    name="workLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Location</FormLabel>
                        <FormControl>
                          <Input placeholder="Work Location" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Cost Center */}
                  <FormField
                    control={form.control}
                    name="costCenter"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Center</FormLabel>
                        <FormControl>
                          <Input placeholder="Cost Center" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Joining Date */}
                  <FormField
                    control={form.control}
                    name="joiningDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Joining Date *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? (
                                  format(new Date(field.value), "PPP")
                                ) : (
                                  <span>Pick a date</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value ? new Date(field.value) : undefined}
                              onSelect={field.onChange}
                              defaultMonth={field.value ? new Date(field.value) : new Date()}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Contract End Date (for Temporary/Contract) */}
                  {form.watch("type") !== "permanent" && (
                    <FormField
                      control={form.control}
                      name="contractEndDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Contract End Date *</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(new Date(field.value), "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value ? new Date(field.value) : undefined}
                                onSelect={field.onChange}
                                disabled={(date) =>
                                  date < new Date(form.getValues("joiningDate"))
                                }
                                defaultMonth={field.value ? new Date(field.value) : 
                                  form.getValues("joiningDate") ? 
                                    new Date(new Date(form.getValues("joiningDate")).setMonth(new Date(form.getValues("joiningDate")).getMonth() + 3)) : 
                                    new Date()
                                }
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Status */}
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status *</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                            <SelectItem value="on_leave">On Leave</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Work Email */}
                  <FormField
                    control={form.control}
                    name="workEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Email</FormLabel>
                        <FormControl>
                          <Input placeholder="work@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Work Phone */}
                  <FormField
                    control={form.control}
                    name="workPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+974 XXXX XXXX" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Probation Period */}
                  <FormField
                    control={form.control}
                    name="probationPeriod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Probation Period (Months)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min={0} 
                            max={12} 
                            {...field}
                            onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Notice Period */}
                  <FormField
                    control={form.control}
                    name="noticePeriod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notice Period (Days)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min={0} 
                            max={90} 
                            {...field}
                            onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-between">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setActiveTab("personal")}
                  >
                    Back: Personal Information
                  </Button>
                  <Button 
                    type="button" 
                    onClick={() => setActiveTab("bank")}
                  >
                    Next: Bank & Emergency Details
                  </Button>
                </div>
              </TabsContent>

              {/* Bank & Emergency Details Tab */}
              <TabsContent value="bank" className="space-y-6">
                <h3 className="text-lg font-medium">Bank Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Bank Name */}
                  <FormField
                    control={form.control}
                    name="bankName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bank Name</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          value={field.value || ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select bank" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {qatarBanks.map((bank) => (
                              <SelectItem key={bank} value={bank}>
                                {bank}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Account Name */}
                  <FormField
                    control={form.control}
                    name="accountName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Account Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Account Holder Name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* IBAN Number */}
                  <FormField
                    control={form.control}
                    name="ibanNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IBAN Number</FormLabel>
                        <FormControl>
                          <Input placeholder="QA12 ABCD 1234 5678 9012 3456" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Swift Code */}
                  <FormField
                    control={form.control}
                    name="swiftCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Swift Code</FormLabel>
                        <FormControl>
                          <Input placeholder="ABCDQAQAQXXX" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                  {/* Bank Branch */}
                  <FormField
                    control={form.control}
                    name="bankBranch"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bank Branch</FormLabel>
                        <FormControl>
                          <Input placeholder="Branch Name/Location" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <h3 className="text-lg font-medium mt-8">Emergency Contact</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Emergency Contact Name */}
                  <FormField
                    control={form.control}
                    name="emergencyContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Full Name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Emergency Contact Number */}
                  <FormField
                    control={form.control}
                    name="emergencyContactNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Number *</FormLabel>
                        <FormControl>
                          <Input placeholder="+974 XXXX XXXX" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Emergency Contact Relation */}
                  <FormField
                    control={form.control}
                    name="emergencyContactRelation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Relationship</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Spouse, Parent, Sibling" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-between">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setActiveTab("employment")}
                  >
                    Back: Employment Details
                  </Button>
                  <Button 
                    type="submit"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <span className="mr-2">Saving...</span>
                        <i className="fas fa-spinner fa-spin"></i>
                      </>
                    ) : (
                      employee ? "Update Employee" : "Add Employee"
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}