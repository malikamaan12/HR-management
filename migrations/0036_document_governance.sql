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
