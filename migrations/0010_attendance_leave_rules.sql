ALTER TABLE attendance ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE FUNCTION advance_attendance_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.version := OLD.version + 1; NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER attendance_record_version BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION advance_attendance_version();
--> statement-breakpoint
CREATE TABLE hr_rules (id serial PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('attendance','leave','payroll')),name text NOT NULL,employee_id integer REFERENCES employees(id),effective_from date NOT NULL,config jsonb NOT NULL,reason text NOT NULL,created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX hr_rules_lookup ON hr_rules(kind,name,employee_id,effective_from DESC,id DESC);
--> statement-breakpoint
CREATE TABLE leave_ledger (id serial PRIMARY KEY,employee_id integer NOT NULL REFERENCES employees(id),leave_type text NOT NULL,year integer NOT NULL,units integer NOT NULL,source_key text NOT NULL UNIQUE,reason text NOT NULL,actor_id integer REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX leave_ledger_balance ON leave_ledger(employee_id,leave_type,year);
--> statement-breakpoint
CREATE TABLE leave_snapshots (leave_id integer PRIMARY KEY REFERENCES leaves(id),rules jsonb NOT NULL,days_by_year jsonb NOT NULL,balance_required boolean NOT NULL,approver_id integer REFERENCES users(id));
--> statement-breakpoint
CREATE TABLE attendance_corrections (id serial PRIMARY KEY,employee_id integer NOT NULL REFERENCES employees(id),date date NOT NULL,expected_version integer NOT NULL,proposal jsonb NOT NULL,before jsonb,reason text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),requested_by integer NOT NULL REFERENCES users(id),reviewed_by integer REFERENCES users(id),review_note text,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz);
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_pending_correction ON attendance_corrections(employee_id,date) WHERE status='pending';
