CREATE TABLE offboarding_cases (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
 tasks jsonb NOT NULL, reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 account_deactivated boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX offboarding_active_employee ON offboarding_cases(employee_id) WHERE status='open';
