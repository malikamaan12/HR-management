import type { ApiDocument } from '@/lib/api-types';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, getStatusClass } from "@/lib/utils";
import { useState, useEffect } from "react";
import { UploadDocumentModal } from "@/components/documents/UploadDocumentModal";
import { DocumentDetails } from "@/components/documents/DocumentDetails";
import { useToast } from "@/hooks/use-toast";

export default function Documents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  
  // Fetch all documents
  const { data: allDocuments, isLoading: isLoadingAll, error: errorAll } = useQuery<ApiDocument[]>({
    queryKey: ['/api/documents'],
    staleTime: 1000 * 60, // 1 minute
  });
  
  // Fetch expiring documents
  const { data: expiringDocuments, isLoading: isLoadingExpiring, error: errorExpiring } = useQuery<ApiDocument[]>({
    queryKey: ['/api/documents/expiring'],
    staleTime: 1000 * 60, // 1 minute
  });

  // Determine appropriate data and loading state based on the active tab
  const isLoading = isLoadingAll || isLoadingExpiring;
  const error = errorAll || errorExpiring;
  
  const documents = allDocuments || [];

  // Refresh data
  const refreshDocuments = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
    queryClient.invalidateQueries({ queryKey: ['/api/documents/expiring'] });
  };
  
  // Filter documents based on active tab and search query
  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = 
      (doc.employeeName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.documentType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.documentNumber.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeTab === "all") return matchesSearch;
    return doc.status === activeTab && matchesSearch;
  });

  const getDocumentCount = (status: string) => {
    return documents.filter(doc => doc.status === status).length;
  };

  // Function to view document details
  const viewDocumentDetails = (documentId: number) => {
    setSelectedDocumentId(documentId);
    setIsDetailsModalOpen(true);
  };

  // Function to download document
  const downloadDocument = (documentId: number) => {
    const document = documents.find(doc => doc.id === documentId);
    if (!document || !document.documentFile) {
      toast({
        title: "No document file",
        description: "This document has no associated file to download.",
        variant: "destructive",
      });
      return;
    }

    // Implement download logic
    window.open(`/api/documents/${document.id}/download`, '_blank', 'noopener,noreferrer');
    
    toast({
      title: "Download requested",
      description: "Your download will open after access is checked.",
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xl font-poppins font-semibold">Document Management</CardTitle>
          <Button 
            className="bg-primary hover:bg-primary/90"
            onClick={() => setIsUploadModalOpen(true)}
          >
            <i className="fas fa-file-upload mr-2"></i> Upload Document
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <div className="relative mb-4">
              <Input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
              <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400"></i>
            </div>
            
            <Tabs defaultValue="all" onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-4 mb-4">
                <TabsTrigger value="all">
                  All Documents
                  <span className="ml-2 px-2 py-0.5 bg-neutral-200 text-neutral-700 rounded-full text-xs">
                    {documents.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="valid">
                  Valid
                  <span className="ml-2 px-2 py-0.5 bg-success/20 text-success rounded-full text-xs">
                    {getDocumentCount('valid')}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="expiring_soon">
                  Expiring Soon
                  <span className="ml-2 px-2 py-0.5 bg-warning/20 text-warning rounded-full text-xs">
                    {getDocumentCount('expiring_soon')}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="expired">
                  Expired
                  <span className="ml-2 px-2 py-0.5 bg-error/20 text-error rounded-full text-xs">
                    {getDocumentCount('expired')}
                  </span>
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value={activeTab} className="mt-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-neutral-200">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Employee</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Document Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Document Number</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Issue Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Expiry Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-neutral-200">
                      {isLoading ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 text-sm text-center text-neutral-500">Loading documents...</td>
                        </tr>
                      ) : error ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 text-sm text-center text-error">Error loading documents</td>
                        </tr>
                      ) : filteredDocuments.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 text-sm text-center text-neutral-500">No documents found</td>
                        </tr>
                      ) : (
                        filteredDocuments.map((doc) => (
                          <tr key={doc.id}>
                            <td className="px-4 py-3 text-sm font-medium text-neutral-800">
                              {doc.employeeName || `Employee #${doc.employeeId}`}
                            </td>
                            <td className="px-4 py-3 text-sm text-neutral-800">
                              {doc.documentType}
                            </td>
                            <td className="px-4 py-3 text-sm text-neutral-800">
                              {doc.documentNumber}
                            </td>
                            <td className="px-4 py-3 text-sm text-neutral-800">
                              {formatDate(doc.issueDate)}
                            </td>
                            <td className="px-4 py-3 text-sm text-neutral-800">
                              {formatDate(doc.expiryDate)}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(doc.status)}`}>
                                {doc.status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-right space-x-2">
                              {doc.documentFile && (
                                <button 
                                  className="text-primary hover:text-primary-dark"
                                  onClick={() => downloadDocument(doc.id)}
                                >
                                  <i className="fas fa-download"></i>
                                </button>
                              )}
                              <button 
                                className="text-neutral-500 hover:text-neutral-700"
                                onClick={() => viewDocumentDetails(doc.id)}
                              >
                                <i className="fas fa-eye"></i>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-poppins font-semibold">Document Expiry Calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-warning/10 border border-warning/30 rounded-md mb-4">
            <div className="flex items-start">
              <i className="fas fa-exclamation-triangle text-warning mt-0.5 mr-3"></i>
              <div>
                <h4 className="font-medium text-neutral-800">Upcoming Document Expirations</h4>
                <p className="text-sm text-neutral-600">
                  There are {getDocumentCount('expiring_soon')} documents expiring in the next 30 days 
                  and {getDocumentCount('expired')} expired documents that need attention.
                </p>
              </div>
            </div>
          </div>

          <div className="h-64 w-full bg-neutral-50 rounded-lg p-4">
            {/* Group documents by expiry month */}
            <div className="grid grid-cols-4 gap-4 h-full">
              {['Jan-Mar', 'Apr-Jun', 'Jul-Sep', 'Oct-Dec'].map((quarter, index) => (
                <div key={index} className="bg-white rounded-md p-3 border shadow-sm">
                  <h3 className="text-sm font-medium mb-2">{quarter}</h3>
                  <div className="space-y-2">
                    {documents
                      .filter(doc => {
                        const expiryDate = new Date(doc.expiryDate);
                        const month = expiryDate.getMonth();
                        if (index === 0) return month >= 0 && month <= 2;
                        if (index === 1) return month >= 3 && month <= 5;
                        if (index === 2) return month >= 6 && month <= 8;
                        if (index === 3) return month >= 9 && month <= 11;
                        return false;
                      })
                      .slice(0, 3) // Show only 3 items per quarter
                      .map(doc => (
                        <div key={doc.id} className="text-xs p-1 border-l-2 border-primary pl-2">
                          <div className="font-medium truncate">{doc.documentType}</div>
                          <div className="text-neutral-500 truncate">
                            Expires: {formatDate(doc.expiryDate)}
                          </div>
                        </div>
                      ))}
                    {documents.filter(doc => {
                      const expiryDate = new Date(doc.expiryDate);
                      const month = expiryDate.getMonth();
                      if (index === 0) return month >= 0 && month <= 2;
                      if (index === 1) return month >= 3 && month <= 5;
                      if (index === 2) return month >= 6 && month <= 8;
                      if (index === 3) return month >= 9 && month <= 11;
                      return false;
                    }).length > 3 && (
                      <div className="text-xs text-primary text-center mt-1">
                        +{documents.filter(doc => {
                          const expiryDate = new Date(doc.expiryDate);
                          const month = expiryDate.getMonth();
                          if (index === 0) return month >= 0 && month <= 2;
                          if (index === 1) return month >= 3 && month <= 5;
                          if (index === 2) return month >= 6 && month <= 8;
                          if (index === 3) return month >= 9 && month <= 11;
                          return false;
                        }).length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload Document Modal */}
      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          refreshDocuments();
        }}
      />

      {/* Document Details Modal */}
      <DocumentDetails
        documentId={selectedDocumentId}
        isOpen={isDetailsModalOpen}
        onClose={() => {
          setIsDetailsModalOpen(false);
          setSelectedDocumentId(null);
        }}
      />
    </div>
  );
}
