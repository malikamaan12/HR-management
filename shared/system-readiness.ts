import { z } from 'zod';

export const storageStepNames = {
  upload: 'Temporary file upload', read: 'Stored file contents', download: 'Signed attachment download',
  privacy: 'Anonymous access denied', cleanup: 'Temporary file removed',
} as const;
export const storageCheckResult = z.object({
  checkedAt: z.string().datetime(),
  status: z.enum(['passed', 'failed']),
  steps: z.array(z.object({ id: z.enum(['upload', 'read', 'download', 'privacy', 'cleanup']), status: z.enum(['passed', 'failed', 'not_run']) })),
  cleanupKey: z.string().regex(/^deployment-checks\/[a-f0-9-]+\.txt$/).nullable(),
});
export type StorageCheckResult = z.infer<typeof storageCheckResult>;
export type SystemReadiness = {
  release?:{revision:string|null;expectedMigrations:number|null;appliedMigrations:number|null};
  security?: {mfaConfigured:boolean;mfaEnforced:boolean;scannerConfigured:boolean;scannerRequired:boolean};
  scheduler?: {mode:string;externalConfigured:boolean;historyAvailable:boolean;jobs:{name:string;lastStatus:string|null;lastFinishedAt:string|null;nextRunAt:string;failures:number}[]};
  checkedAt: string;
  database: { status: 'available' | 'unavailable' };
  storage: { configured: boolean; provider: string; canVerify: boolean; running: boolean;
    lastCheck: StorageCheckResult | null; configurationChanged: boolean; historyAvailable: boolean };
  email: { configured: boolean; missing: string[]; delivery: 'not_verified' };
  application: { originConfigured: boolean; timezone: string; timezoneValid: boolean };
};
