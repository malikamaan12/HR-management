CREATE TABLE employment_watch_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0), watch_days integer NOT NULL CHECK(watch_days BETWEEN 1 AND 365),
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE contract_renewals (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), employee_version integer NOT NULL,
 previous_end_date date NOT NULL, new_end_date date NOT NULL CHECK(new_end_date>previous_end_date), effective_date date NOT NULL CHECK(effective_date<=new_end_date),
 agreement_reference text NOT NULL, proposal_reason text NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','cancelled','applied')),
 created_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id), approved_at timestamptz,
 applied_by integer REFERENCES users(id), applied_at timestamptz, decision_reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('approved','applied') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL)),
 CHECK(status<>'applied' OR (applied_by IS NOT NULL AND applied_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX contract_renewal_pending ON contract_renewals(employee_id) WHERE status IN ('submitted','approved');
--> statement-breakpoint
CREATE TABLE return_work_clearances (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), employee_version integer NOT NULL,
 return_date date NOT NULL, exit_ids integer[] NOT NULL CHECK(cardinality(exit_ids)>0), exit_snapshot jsonb NOT NULL,
 reference text NOT NULL, proposal_reason text NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','cancelled','revoked')),
 created_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id), approved_at timestamptz,
 decision_reason text, version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'approved' OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX return_work_pending ON return_work_clearances(employee_id) WHERE status='submitted';
--> statement-breakpoint
CREATE INDEX return_work_approved ON return_work_clearances(employee_id) WHERE status='approved';
--> statement-breakpoint
CREATE TABLE exit_checklist_templates (
 id serial PRIMARY KEY, name text NOT NULL, employee_types jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true,
 tasks jsonb NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX exit_template_name ON exit_checklist_templates(lower(trim(name)));
--> statement-breakpoint
ALTER TABLE offboarding_cases ADD COLUMN template_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE offboarding_cases ADD COLUMN target_exit_date date;
--> statement-breakpoint
ALTER TABLE offboarding_cases ADD COLUMN decision_reason text;
