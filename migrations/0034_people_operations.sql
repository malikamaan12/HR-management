CREATE TABLE people_operation_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0), rules jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE probation_reviews (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), reviewer_id integer NOT NULL REFERENCES users(id),
 start_date date NOT NULL, due_date date NOT NULL CHECK(due_date>=start_date), objectives text NOT NULL, policy_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted','confirmed','follow_up','cancelled')),
 recommendation text CHECK(recommendation IN ('confirm','extend','follow_up')), review_evidence text,
 extension_count integer NOT NULL DEFAULT 0 CHECK(extension_count>=0), decision_reason text, decided_by integer REFERENCES users(id),
 acknowledged_at timestamptz, employee_response text, created_by integer NOT NULL REFERENCES users(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('submitted','confirmed','follow_up') OR (recommendation IS NOT NULL AND review_evidence IS NOT NULL)),
 CHECK(status NOT IN ('confirmed','follow_up') OR (decided_by IS NOT NULL AND decision_reason IS NOT NULL AND decided_by<>reviewer_id))
);
--> statement-breakpoint
CREATE UNIQUE INDEX probation_active_employee ON probation_reviews(employee_id) WHERE status IN ('open','submitted');
--> statement-breakpoint
CREATE TABLE employee_transfers (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), employee_version integer NOT NULL,
 from_snapshot jsonb NOT NULL, to_snapshot jsonb NOT NULL, effective_date date NOT NULL, proposal_reason text NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','cancelled','applied')),
 created_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id), approved_at timestamptz,
 applied_by integer REFERENCES users(id), applied_at timestamptz, decision_reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('approved','applied') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL)),
 CHECK(status<>'applied' OR (applied_by IS NOT NULL AND applied_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX transfer_active_employee ON employee_transfers(employee_id) WHERE status IN ('submitted','approved');
--> statement-breakpoint
CREATE TABLE operational_incidents (
 id serial PRIMARY KEY, reporter_id integer NOT NULL REFERENCES users(id), team_id integer REFERENCES workforce_teams(id),
 title text NOT NULL, location text NOT NULL, occurred_at timestamptz NOT NULL, category text NOT NULL CHECK(category IN ('equipment','service','attendance','site_operations','other')),
 severity text NOT NULL CHECK(severity IN ('low','medium','high')), description text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
 handler_id integer REFERENCES users(id), corrective_action text, resolution text, resolved_at timestamptz, closed_by integer REFERENCES users(id),
 due_at timestamptz NOT NULL, policy_snapshot jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('in_progress','resolved','closed') OR (handler_id IS NOT NULL AND corrective_action IS NOT NULL)),
 CHECK(status NOT IN ('resolved','closed') OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)),
 CHECK(status<>'closed' OR (closed_by IS NOT NULL AND closed_by<>handler_id AND closed_by<>reporter_id))
);
--> statement-breakpoint
CREATE INDEX incident_reporter ON operational_incidents(reporter_id,id);
--> statement-breakpoint
CREATE INDEX incident_handler ON operational_incidents(handler_id,status);
--> statement-breakpoint
CREATE INDEX probation_reviewer ON probation_reviews(reviewer_id,status);
