CREATE TABLE helpdesk_target_policies (
 id serial PRIMARY KEY, category text NOT NULL, version integer NOT NULL,
 response_hours integer CHECK (response_hours BETWEEN 1 AND 720),
 resolution_hours integer CHECK (resolution_hours BETWEEN 1 AND 2160),
 reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamp NOT NULL DEFAULT now(),
 UNIQUE(category,version)
);
--> statement-breakpoint
ALTER TABLE helpdesk_cases ADD COLUMN target_snapshot jsonb, ADD COLUMN response_due_at timestamptz,
 ADD COLUMN resolution_due_at timestamptz, ADD COLUMN first_response_at timestamptz, ADD COLUMN resolved_at timestamptz;
