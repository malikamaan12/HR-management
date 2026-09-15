CREATE TABLE employee_lifecycle_events (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('hire','transfer','promotion','probation_started','probation_completed','contract_renewal','termination','reactivation','correction')),
  effective_date date NOT NULL,
  reason text NOT NULL,
  notes text,
  metadata jsonb,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX employee_lifecycle_employee_date ON employee_lifecycle_events(employee_id,effective_date DESC,id DESC);
--> statement-breakpoint
CREATE INDEX employee_lifecycle_type_date ON employee_lifecycle_events(event_type,effective_date DESC);
