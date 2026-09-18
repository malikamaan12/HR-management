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
