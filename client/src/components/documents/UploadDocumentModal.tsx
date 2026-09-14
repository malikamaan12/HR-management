import { useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CalendarIcon, Upload, File as FileIcon, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Define a type for File objects
type DocumentFile = File | string;

const documentSchema = z.object({
  employeeId: z.string().min(1, { message: "Employee is required" }),
  documentType: z.string().min(1, { message: "Document type is required" }),
  documentNumber: z.string().min(1, { message: "Document number is required" }),
  issueDate: z.date({ required_error: "Issue date is required" }),
  expiryDate: z.date({ required_error: "Expiry date is required" }),
  status: z.string().default("valid"),
  issueAuthority: z.string().optional(),
  notes: z.string().optional(),
  documentFile: z.custom<DocumentFile>().optional(), // Using custom type for File objects
});

type DocumentFormValues = z.infer<typeof documentSchema>;

interface UploadDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee?: { id: number; firstName: string; lastName: string };
}

export function UploadDocumentModal({ isOpen, onClose, employee }: UploadDocumentModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentSchema),
    defaultValues: {
      employeeId: employee ? String(employee.id) : "",
      documentType: "",
      documentNumber: "",
      status: "valid",
      issueAuthority: "",
      notes: "",
    },
  });

  useEffect(() => { if (isOpen && employee) form.setValue('employeeId', String(employee.id)); }, [isOpen, employee?.id, form]);

  async function onSubmit(data: DocumentFormValues) {
    setIsSubmitting(true);
    
    try {
      if(!(data.documentFile instanceof File))throw new Error('Choose a document file');
      const body=new FormData();
      body.append('document',data.documentFile);
      body.append('employeeId',data.employeeId);
      body.append('documentType',data.documentType);
      body.append('documentNumber',data.documentNumber);
      body.append('issueDate',format(data.issueDate,'yyyy-MM-dd'));
      body.append('expiryDate',format(data.expiryDate,'yyyy-MM-dd'));
      body.append('issueAuthority',data.issueAuthority || '');
      body.append('notes',data.notes || '');
      await apiRequest('/api/documents',{method:'POST',body});
      
      // Show success toast
      toast({
        title: "Document uploaded",
        description: "The document has been successfully uploaded.",
      });
      
      // Reset form and invalidate queries to refresh document list
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documents/expiring'] });
      queryClient.invalidateQueries({ queryKey: [`/api/employees/${data.employeeId}/documents`] });
      
      // Close modal
      onClose();
    } catch (error) {
      console.error("Error uploading document:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Upload failed",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Define Employee interface
interface Employee {
  id: number;
  firstName: string;
  lastName: string;
}

// Fetch employees for the dropdown
  const { data: availableEmployees } = useQuery<Employee[]>({
    queryKey: ['/api/employees'],
    enabled: isOpen && !employee,
    staleTime: 1000 * 60, // 1 minute
  });

  const employees = employee ? [employee] : availableEmployees;

  const documentTypes = [
    "Passport",
    "Visa",
    "Work Permit",
    "Residency Permit",
    "ID Card",
    "Health Card",
    "Driving License",
    "Educational Certificate",
    "Professional Certificate",
    "Medical Certificate",
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Upload New Document</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="employeeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    disabled={!!employee}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an employee" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {employees && employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id.toString()}>
                          {`${employee.firstName} ${employee.lastName}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="documentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document Type</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select document type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {documentTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="documentNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document Number</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter document number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="issueDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Issue Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
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
                          selected={field.value}
                          onSelect={field.onChange}
                          defaultMonth={field.value || new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="expiryDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Expiry Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
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
                          selected={field.value}
                          onSelect={field.onChange}
                          defaultMonth={field.value ? field.value : 
                            form.getValues("issueDate") ? 
                              new Date(new Date(form.getValues("issueDate")).setFullYear(new Date(form.getValues("issueDate")).getFullYear() + 1)) : 
                              new Date(new Date().setFullYear(new Date().getFullYear() + 1))
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="issueAuthority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Issuing Authority</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter issuing authority" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="documentFile"
              render={({ field: { value, onChange, ...fieldProps } }) => {
                const [dragActive, setDragActive] = useState(false);
                const inputRef = useCallback((node: HTMLInputElement) => {
                  if (node) {
                    node.addEventListener('dragenter', () => setDragActive(true));
                  }
                }, []);
                
                // Handle drag events
                const handleDrag = useCallback((e: React.DragEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.type === "dragenter" || e.type === "dragover") {
                    setDragActive(true);
                  } else if (e.type === "dragleave") {
                    setDragActive(false);
                  }
                }, []);
                
                // Handle drop event
                const handleDrop = useCallback((e: React.DragEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragActive(false);
                  
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    // Check if file type is accepted
                    if (file.type.includes("pdf") || 
                        file.type.includes("image/jpeg") || 
                        file.type.includes("image/jpg") || 
                        file.type.includes("image/png")) {
                      onChange(file);
                    } else {
                      toast({
                        title: "Invalid file type",
                        description: "Please upload a PDF or image file (JPG, PNG)",
                        variant: "destructive",
                      });
                    }
                  }
                }, [onChange, toast]);
                
                // Clear file
                const clearFile = () => {
                  onChange(undefined);
                };
                
                return (
                  <FormItem>
                    <FormLabel>Document File</FormLabel>
                    <FormControl>
                      <div 
                        className={cn(
                          "border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors",
                          dragActive ? "border-primary bg-primary/5" : "border-border",
                          value ? "bg-primary/5" : "hover:bg-accent"
                        )}
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => document.getElementById('file-upload')?.click()}
                      >
                        <input
                          id="file-upload"
                          ref={inputRef}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              onChange(file);
                            }
                          }}
                          className="hidden"
                        />
                        
                        {value ? (
                          <div className="flex flex-col items-center justify-center gap-2">
                            <div className="flex items-center gap-2 text-primary">
                              <FileIcon className="h-8 w-8" />
                              <span className="font-medium">
                                {value instanceof File 
                                  ? (value as File).name 
                                  : typeof value === 'string'
                                    ? value
                                    : 'Selected file'}
                              </span>
                            </div>
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="sm" 
                              className="mt-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                clearFile();
                              }}
                            >
                              <X className="h-4 w-4 mr-1" /> Remove File
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Upload className="h-10 w-10 text-muted-foreground mb-2" />
                            <p className="text-sm font-medium">
                              Drag & drop your file here or click to browse
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Accepted formats: PDF, JPG, PNG
                            </p>
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      Upload document file (PDF, JPG, PNG)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Add any additional notes" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin mr-2">
                      <i className="fas fa-spinner"></i>
                    </span>
                    Uploading...
                  </>
                ) : (
                  'Upload Document'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}