CREATE TABLE leave_ledger (
 id serial PRIMARY KEY,
 employee_id integer NOT NULL REFERENCES employees(id),
 leave_type text NOT NULL,
 year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
 days integer NOT NULL CHECK (days <> 0 AND days BETWEEN -3660 AND 3660),
 reason text NOT NULL,
 reference text NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamp NOT NULL DEFAULT now(),
 UNIQUE(employee_id, leave_type, year, reference)
);
--> statement-breakpoint
CREATE INDEX leave_ledger_account ON leave_ledger(employee_id,leave_type,year);
