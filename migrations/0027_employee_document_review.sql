CREATE TABLE hr_workflow_history (id serial PRIMARY KEY,kind text NOT NULL,record_id integer NOT NULL,version integer NOT NULL CHECK(version>0),snapshot jsonb NOT NULL,actor_id integer NOT NULL REFERENCES users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,record_id,version));

--> statement-breakpoint
ALTER TABLE bulk_import_jobs ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
--> statement-breakpoint
ALTER TABLE bulk_import_jobs ADD COLUMN submission_key uuid;
--> statement-breakpoint
ALTER TABLE bulk_import_jobs ADD COLUMN file_hash text;
--> statement-breakpoint
ALTER TABLE bulk_import_jobs ADD COLUMN included_rows integer NOT NULL DEFAULT 0 CHECK(included_rows>=0);
--> statement-breakpoint
ALTER TABLE bulk_import_jobs ADD COLUMN validated_at timestamptz;
--> statement-breakpoint
ALTER TABLE bulk_import_jobs ADD COLUMN committed_from_version integer;
--> statement-breakpoint
CREATE UNIQUE INDEX import_submission_key ON bulk_import_jobs(uploaded_by,submission_key) WHERE submission_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX import_owner_recent ON bulk_import_jobs(uploaded_by,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE employee_import_rows (
 id serial PRIMARY KEY, job_id integer NOT NULL REFERENCES bulk_import_jobs(id) ON DELETE CASCADE,
 row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 501), included boolean NOT NULL DEFAULT true,
 payload jsonb NOT NULL, errors jsonb NOT NULL DEFAULT '[]'::jsonb,
 employee_id integer REFERENCES employees(id), UNIQUE(job_id,row_number)
);

--> statement-breakpoint
CREATE TABLE employee_corrections (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), requester_id integer NOT NULL REFERENCES users(id),
 employee_version integer NOT NULL, patch jsonb NOT NULL, previous_values jsonb NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
 decided_by integer REFERENCES users(id), decision_reason text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX employee_pending_correction ON employee_corrections(employee_id) WHERE status='pending';

--> statement-breakpoint
CREATE TABLE document_review_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0),
 replacement_mode text NOT NULL CHECK(replacement_mode IN ('optional','self_service','all')),
 document_types jsonb NOT NULL, require_assigned_reviewer boolean NOT NULL,
 review_days integer NOT NULL CHECK(review_days BETWEEN 1 AND 365),
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE document_renewal_requests ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
--> statement-breakpoint
ALTER TABLE document_renewal_requests ADD COLUMN assigned_reviewer_id integer REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE document_renewal_requests ADD COLUMN policy_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE document_renewal_requests ADD COLUMN review_due_date date;
--> statement-breakpoint
ALTER TABLE document_renewal_requests ADD CONSTRAINT renewal_reviewer_independent CHECK(assigned_reviewer_id IS NULL OR assigned_reviewer_id<>requested_by);
--> statement-breakpoint
CREATE INDEX document_renewal_assignment ON document_renewal_requests(assigned_reviewer_id,status,id);
--> statement-breakpoint
CREATE INDEX document_expiry_register ON documents(expiry_date,id);
