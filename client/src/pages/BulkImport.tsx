import { apiJson } from '@/lib/queryClient';
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Download, Upload, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { UploadResult } from "@uppy/core";

interface BulkImportJob {
  id: number;
  fileName: string;
  fileUrl: string;
  uploadedBy: number;
  status: "processing" | "completed" | "failed";
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  errorLog?: Array<{ row: number; field: string; message: string; data: any }>;
  createdAt: string;
  completedAt?: string;
}

const BulkImport = () => {
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query for all import jobs
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<BulkImportJob[]>({
    queryKey: ["/api/bulk-import/jobs"],
  });

  // Query for current job status (polling)
  const { data: currentJob } = useQuery<BulkImportJob>({
    queryKey: ["/api/bulk-import/job", currentJobId],
    enabled: !!currentJobId,
    refetchInterval: currentJobId ? 2000 : false, // Poll every 2 seconds when job is active
  });

  // Stop polling when job is completed or failed
  useEffect(() => {
    if (currentJob && (currentJob.status === "completed" || currentJob.status === "failed")) {
      setCurrentJobId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-import/jobs"] });
      
      if (currentJob.status === "completed") {
        toast({
          title: "Import Completed",
          description: `Successfully imported ${currentJob.successfulRows} out of ${currentJob.totalRows} employees`,
          variant: "default",
        });
      } else {
        toast({
          title: "Import Failed",
          description: `Import failed with ${currentJob.failedRows} errors`,
          variant: "destructive",
        });
      }
    }
  }, [currentJob, queryClient, toast]);

  const createJobMutation=useMutation({mutationFn:async(file:File)=>{const body=new FormData();body.append('file',file);return apiJson<{jobId:number}>('/api/bulk-import/upload',{method:'POST',body});},
    onSuccess:data=>{setCurrentJobId(data.jobId);queryClient.invalidateQueries({queryKey:['/api/bulk-import/jobs']});queryClient.invalidateQueries({queryKey:['/api/employees']});},
    onError:error=>toast({title:'Import failed',description:error.message,variant:'destructive'})});

  // Download template
  const downloadTemplate = () => {
    window.open("/api/bulk-import/template", "_blank");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "processing":
        return <Badge variant="secondary" className="flex items-center gap-1"><Clock className="w-3 h-3" />Processing</Badge>;
      case "completed":
        return <Badge variant="default" className="flex items-center gap-1 bg-green-500"><CheckCircle className="w-3 h-3" />Completed</Badge>;
      case "failed":
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="w-3 h-3" />Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getProgress = (job: BulkImportJob) => {
    if (job.totalRows === 0) return 0;
    return ((job.successfulRows + job.failedRows) / job.totalRows) * 100;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bulk Employee Import</h1>
        <p className="text-muted-foreground">
          Import multiple employees from a CSV file
        </p>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Employee Data
          </CardTitle>
          <CardDescription>
            Upload a CSV file containing employee information to import multiple employees at once
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Important:</strong> Make sure your CSV file follows the required format. 
              Download the template below to see the expected structure.
            </AlertDescription>
          </Alert>

          <div className="flex gap-4">
            <Button variant="outline" onClick={downloadTemplate} className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Download Template
            </Button>

            <label className="space-y-2">CSV file (up to 500 rows, 2 MB)
              <input type="file" accept=".csv,text/csv" disabled={createJobMutation.isPending} onChange={e=>{const file=e.target.files?.[0];if(file)createJobMutation.mutate(file);e.target.value='';}}/>
              {createJobMutation.isPending && <p>Processing import…</p>}
            </label>
          </div>

          {/* Current Job Progress */}
          {currentJob && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Processing: {currentJob.fileName}</h4>
                    {getStatusBadge(currentJob.status)}
                  </div>
                  
                  <Progress value={getProgress(currentJob)} className="w-full" />
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total Rows</p>
                      <p className="font-medium">{currentJob.totalRows}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Successful</p>
                      <p className="font-medium text-green-600">{currentJob.successfulRows}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Failed</p>
                      <p className="font-medium text-red-600">{currentJob.failedRows}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Import History */}
      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
          <CardDescription>
            View previous bulk import jobs and their results
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No import jobs found. Upload your first CSV file to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">{job.fileName}</h4>
                      <p className="text-sm text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                        {job.completedAt && ` - Completed ${new Date(job.completedAt).toLocaleString()}`}
                      </p>
                    </div>
                    {getStatusBadge(job.status)}
                  </div>

                  {job.totalRows > 0 && (
                    <>
                      <Progress value={getProgress(job)} className="w-full" />
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Total Rows</p>
                          <p className="font-medium">{job.totalRows}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Successful</p>
                          <p className="font-medium text-green-600">{job.successfulRows}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Failed</p>
                          <p className="font-medium text-red-600">{job.failedRows}</p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Error Details */}
                  {job.errorLog && job.errorLog.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-red-600 hover:text-red-700">
                        View Errors ({job.errorLog.length})
                      </summary>
                      <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                        {job.errorLog.slice(0, 10).map((error, index) => (
                          <div key={index} className="text-xs bg-red-50 p-2 rounded border border-red-200">
                            <p><strong>Row {error.row}:</strong> {error.message}</p>
                            {error.field && <p className="text-muted-foreground">Field: {error.field}</p>}
                          </div>
                        ))}
                        {job.errorLog.length > 10 && (
                          <p className="text-xs text-muted-foreground">
                            ... and {job.errorLog.length - 10} more errors
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BulkImport;