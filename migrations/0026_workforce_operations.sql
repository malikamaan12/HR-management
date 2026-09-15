ALTER TABLE workforce_shifts ADD COLUMN version integer NOT NULL DEFAULT 1, ADD COLUMN cancelled_at timestamptz, ADD COLUMN supersedes_id integer REFERENCES workforce_shifts(id);
--> statement-breakpoint
CREATE TABLE workforce_availability (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), start_at timestamptz NOT NULL,
 end_at timestamptz NOT NULL, kind text NOT NULL CHECK(kind IN ('available','unavailable')),
 cancelled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_at > start_at)
);
--> statement-breakpoint
CREATE INDEX workforce_availability_employee_window ON workforce_availability(employee_id,start_at,end_at) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE TABLE workforce_series (
 id serial PRIMARY KEY, team_id integer NOT NULL REFERENCES workforce_teams(id), created_by integer NOT NULL REFERENCES users(id),
 request_key text NOT NULL, payload jsonb NOT NULL, shift_ids jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(created_by,request_key)
);
--> statement-breakpoint
CREATE TABLE workforce_shift_history (
 id serial PRIMARY KEY, shift_id integer NOT NULL REFERENCES workforce_shifts(id), version integer NOT NULL,
 snapshot jsonb NOT NULL, reason text NOT NULL, actor_id integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shift_id,version)
);
--> statement-breakpoint
CREATE TABLE workforce_replacements (
 id serial PRIMARY KEY, original_id integer NOT NULL UNIQUE REFERENCES workforce_assignments(id), replacement_id integer NOT NULL REFERENCES workforce_assignments(id),
 reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
