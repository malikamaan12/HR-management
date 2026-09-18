CREATE TABLE employment_policies (
  id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK (version > 0),
  definition jsonb NOT NULL, created_by integer NOT NULL REFERENCES users(id),
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE employment_changes (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id),
  employee_version integer NOT NULL CHECK (employee_version > 0),
  kind text NOT NULL CHECK (kind IN ('transfer','promotion','contract_renewal','assignment_change')),
  effective_date date NOT NULL, before_values jsonb NOT NULL, after_values jsonb NOT NULL,
  policy_snapshot jsonb NOT NULL, reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','cancelled','applied')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  requested_by integer NOT NULL REFERENCES users(id), reviewed_by integer REFERENCES users(id),
  reviewed_at timestamptz, decision_reason text, applied_by integer REFERENCES users(id), applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved','applied') OR (reviewed_by IS NOT NULL AND reviewed_by <> requested_by)),
  CHECK (status <> 'applied' OR (applied_by IS NOT NULL AND applied_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX employment_change_employee ON employment_changes(employee_id,id DESC);
CREATE INDEX employment_change_queue ON employment_changes(status,effective_date,id);
--> statement-breakpoint
CREATE TABLE employment_service_periods (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id),
  start_date date NOT NULL, end_date date, qualifies boolean NOT NULL, service_type text NOT NULL
    CHECK (service_type IN ('permanent','temporary','contract')),
  note text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  source text NOT NULL DEFAULT 'reviewed' CHECK (source IN ('reviewed','profile_baseline','lifecycle')),
  source_reference jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by integer NOT NULL REFERENCES users(id),
  approved_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
--> statement-breakpoint
CREATE INDEX employment_service_employee ON employment_service_periods(employee_id,start_date);
--> statement-breakpoint
CREATE TABLE employment_period_requests (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id),
  action text NOT NULL CHECK (action IN ('record','correct','void')),
  target_period_id integer REFERENCES employment_service_periods(id), expected_period_version integer,
  period_data jsonb, policy_snapshot jsonb NOT NULL, reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), requested_by integer NOT NULL REFERENCES users(id),
  reviewed_by integer REFERENCES users(id), decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'record' AND target_period_id IS NULL AND expected_period_version IS NULL) OR
    (action <> 'record' AND target_period_id IS NOT NULL AND expected_period_version > 0)),
  CHECK (action = 'void' OR period_data IS NOT NULL),
  CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_by <> requested_by))
);
--> statement-breakpoint
CREATE INDEX employment_period_request_employee ON employment_period_requests(employee_id,id DESC);
CREATE UNIQUE INDEX employment_period_request_pending ON employment_period_requests(target_period_id) WHERE status='requested' AND target_period_id IS NOT NULL;
