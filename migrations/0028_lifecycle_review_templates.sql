ALTER TABLE lifecycle_templates ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0), ADD COLUMN active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE lifecycle_review_policies (id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version > 0), task_kinds jsonb NOT NULL, review_days integer NOT NULL CHECK(review_days BETWEEN 1 AND 365), created_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE lifecycle_cases ADD COLUMN review_policy_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE lifecycle_tasks ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0), ADD COLUMN review_required boolean NOT NULL DEFAULT false, ADD COLUMN review_state text NOT NULL DEFAULT 'not_required' CHECK(review_state IN ('not_required','required','pending','returned','approved')), ADD COLUMN document_type text NOT NULL DEFAULT '', ADD COLUMN document_snapshot jsonb, ADD COLUMN submitted_by integer REFERENCES users(id), ADD COLUMN submitted_at timestamptz, ADD COLUMN review_due_date date, ADD COLUMN reviewed_by integer REFERENCES users(id), ADD COLUMN reviewed_at timestamptz, ADD COLUMN review_note text;
--> statement-breakpoint
ALTER TABLE lifecycle_tasks ADD CONSTRAINT lifecycle_review_completion CHECK (NOT review_required OR status <> 'completed' OR (review_state='approved' AND submitted_by IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_by<>submitted_by AND reviewed_by<>owner_id));
--> statement-breakpoint
CREATE INDEX lifecycle_pending_review ON lifecycle_tasks(review_due_date,case_id) WHERE review_state='pending';
