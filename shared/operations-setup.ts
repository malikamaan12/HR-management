export type OperationsSetupSectionId = 'people' | 'locations' | 'supervisors' | 'leave' | 'induction';
export type OperationsSetupStatus = 'ready' | 'action_required' | 'not_started';
export interface OperationsSetupIssue { key: string; message: string; href: string }
export interface OperationsSetupSection {
  id: OperationsSetupSectionId;
  title: string;
  status: OperationsSetupStatus;
  summary: string;
  issues: OperationsSetupIssue[];
  /** Includes issues beyond the first 50 displayed entries. */
  issueCount: number;
}
export interface OperationsSetupResponse {
  asOf: string;
  counts: { activeEmployees: number; linkedEmployees: number; readyEmployees: number; setupPendingEmployees: number; teams: number; sites: number };
  sections: OperationsSetupSection[];
  /** A data limit was reached; affected checks must not be treated as complete. */
  truncated: boolean;
}
