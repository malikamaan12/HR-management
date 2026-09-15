CREATE TABLE employee_corrections (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), requester_id integer NOT NULL REFERENCES users(id),
 employee_version integer NOT NULL, patch jsonb NOT NULL, previous_values jsonb NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
 decided_by integer REFERENCES users(id), decision_reason text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX employee_pending_correction ON employee_corrections(employee_id) WHERE status='pending';
