CREATE TABLE workforce_unavailable (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at), note text NOT NULL, created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz, cancelled_by integer REFERENCES users(id), cancellation_reason text
);
--> statement-breakpoint
CREATE INDEX workforce_unavailable_employee ON workforce_unavailable(employee_id, start_at) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE TABLE workforce_qualifications (
  id serial PRIMARY KEY, name text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX workforce_qualification_name ON workforce_qualifications(lower(name));
--> statement-breakpoint
CREATE TABLE employee_qualifications (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), qualification_id integer NOT NULL REFERENCES workforce_qualifications(id),
  valid_from date NOT NULL, valid_through date CHECK (valid_through >= valid_from), verification_reference text NOT NULL,
  verified_by integer NOT NULL REFERENCES users(id), verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, revoked_by integer REFERENCES users(id), revocation_reason text
);
--> statement-breakpoint
CREATE INDEX employee_qualification_validity ON employee_qualifications(employee_id, qualification_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE workforce_shifts ADD COLUMN required_qualifications jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_qualifications) = 'array');
--> statement-breakpoint
ALTER TABLE workforce_assignments ADD COLUMN replaces_assignment_id integer REFERENCES workforce_assignments(id), ADD COLUMN replacement_reason text,
  ADD CONSTRAINT workforce_replacement_not_self CHECK (replaces_assignment_id <> id),
  ADD CONSTRAINT workforce_replacement_reason CHECK ((replaces_assignment_id IS NULL) = (replacement_reason IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX workforce_pending_replacement ON workforce_assignments(replaces_assignment_id) WHERE status = 'offered' AND replaces_assignment_id IS NOT NULL;
