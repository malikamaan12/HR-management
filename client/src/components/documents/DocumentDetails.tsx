import type { ApiDocument, ApiEmployee } from '@/lib/api-types';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatDate, getStatusClass } from "@/lib/utils";

interface DocumentDetailsProps {
  documentId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DocumentDetails({ documentId, isOpen, onClose }: DocumentDetailsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("details");
  
  // Fetch document details
  const { data: document, isLoading, error } = useQuery<ApiDocument>({
    queryKey: ['/api/documents', documentId],
    staleTime: 1000 * 60, // 1 minute
    enabled: !!documentId && isOpen,
  });

  // Fetch employee details
  const { data: employee } = useQuery<ApiEmployee>({
    queryKey: ['/api/employees', document?.employeeId],
    staleTime: 1000 * 60, // 1 minute
    enabled: !!document?.employeeId && isOpen,
  });

  // Function to refresh document
  const refreshDocument = () => {
    if (documentId) {
      queryClient.invalidateQueries({ queryKey: ['/api/documents', documentId] });
    }
  };

  // Function to download document
  const downloadDocument = async () => {
    if (!document?.documentFile) {
      toast({
        title: "No document file",
        description: "This document has no associated file to download.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Implement download logic
      window.open(`/api/documents/${document.id}/download`, '_blank', 'noopener,noreferrer');
      
      toast({
        title: "Download requested",
        description: "Your download will open after access is checked.",
      });
    } catch (error) {
      console.error("Error downloading document:", error);
      toast({
        title: "Download failed",
        description: "There was an error downloading the document. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[650px]">
        <DialogHeader>
          <DialogTitle>Document Details</DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-error">
            <p>Error loading document details</p>
            <Button onClick={refreshDocument} variant="outline" className="mt-2">
              <i className="fas fa-sync-alt mr-2"></i> Retry
            </Button>
          </div>
        ) : document ? (
          <div>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold">{document.documentType}</h3>
                <p className="text-sm text-neutral-500">
                  {document.documentNumber}
                </p>
              </div>
              <Badge className={getStatusClass(document.status)}>
                {document.status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
              </Badge>
            </div>
            
            <Tabs defaultValue="details" onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-2 mb-4">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="preview">Document Preview</TabsTrigger>
              </TabsList>
              
              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4 border-b pb-4">
                  <div>
                    <p className="text-sm font-medium text-neutral-500">Employee</p>
                    <p>
                      {employee ? 
                        `${employee.firstName} ${employee.lastName}` : 
                        `Employee #${document.employeeId}`
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-500">Document Type</p>
                    <p>{document.documentType}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-500">Document Number</p>
                    <p>{document.documentNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-500">Issuing Authority</p>
                    <p>{document.issueAuthority || 'Not specified'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-500">Issue Date</p>
                    <p>{formatDate(document.issueDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-500">Expiry Date</p>
                    <p>{formatDate(document.expiryDate)}</p>
                  </div>
                </div>
                
                {document.notes && (
                  <div>
                    <p className="text-sm font-medium text-neutral-500 mb-1">Notes</p>
                    <p className="text-sm">{document.notes}</p>
                  </div>
                )}
                
                <div>
                  <p className="text-sm font-medium text-neutral-500 mb-1">Document History</p>
                  <div className="border rounded-md p-3 text-sm">
                    <div className="flex justify-between pb-2 mb-2 border-b">
                      <span>Created</span>
                      <span>{formatDate(document.createdAt)}</span>
                    </div>
                    {document.updatedAt && document.updatedAt !== document.createdAt && (
                      <div className="flex justify-between">
                        <span>Last Updated</span>
                        <span>{formatDate(document.updatedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="preview" className="min-h-[300px]">
                <div className="p-8 text-center">
                  <p>{document.documentFile ? 'This file is stored privately. Download it to view its contents.' : 'No document file available'}</p>
                  {document.documentFile && <Button className="mt-4" onClick={downloadDocument}>Download document</Button>}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="p-4 text-center text-neutral-500">
            <p>No document selected</p>
          </div>
        )}
        
        <DialogFooter>
          {document && document.documentFile && (
            <Button 
              variant="outline" 
              onClick={downloadDocument} 
              className="mr-auto"
            >
              <i className="fas fa-download mr-2"></i> Download
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}