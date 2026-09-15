ALTER TABLE attendance ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE FUNCTION attendance_version_step() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.version=OLD.version+1; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER attendance_version_step BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION attendance_version_step();
--> statement-breakpoint
CREATE TABLE attendance_corrections (
 id serial PRIMARY KEY, attendance_id integer NOT NULL REFERENCES attendance(id), employee_id integer NOT NULL REFERENCES employees(id),
 original_version integer NOT NULL, proposed jsonb NOT NULL, original jsonb NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
 requested_by integer NOT NULL REFERENCES users(id), decided_by integer REFERENCES users(id), decision_reason text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_correction_pending ON attendance_corrections(attendance_id) WHERE status='pending';
--> statement-breakpoint
CREATE TABLE operations_policies (
 id serial PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('leave','timepay')), scope text NOT NULL, effective_from date NOT NULL, rules jsonb NOT NULL,
 reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX operations_policy_lookup ON operations_policies(kind,scope,effective_from,id);
--> statement-breakpoint
ALTER TABLE leave_ledger ALTER COLUMN days TYPE double precision;
--> statement-breakpoint
ALTER TABLE leave_ledger DROP CONSTRAINT leave_ledger_days_check;
--> statement-breakpoint
ALTER TABLE leave_ledger ADD CONSTRAINT leave_ledger_days_check CHECK(days BETWEEN -3660 AND 3660 AND abs(days*100-round(days*100))<0.000001);
--> statement-breakpoint
ALTER TABLE leave_ledger ADD COLUMN basis jsonb;
--> statement-breakpoint
ALTER TABLE leaves ALTER COLUMN total_days TYPE double precision;
--> statement-breakpoint
ALTER TABLE leaves ADD COLUMN day_fraction double precision NOT NULL DEFAULT 1 CHECK(day_fraction IN (0.5,1));
--> statement-breakpoint
CREATE TABLE leave_year_splits (
 leave_id integer NOT NULL REFERENCES leaves(id), year integer NOT NULL CHECK(year BETWEEN 2000 AND 2200), days double precision NOT NULL CHECK(days>=0 AND days<=367),
 reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(leave_id,year)
);
--> statement-breakpoint
CREATE TABLE payroll_time_entries (
 id serial PRIMARY KEY, payroll_id integer NOT NULL REFERENCES payroll(id), timesheet_id integer REFERENCES workforce_timesheets(id),
 amount_cents integer NOT NULL, basis jsonb NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_time_sheet_active ON payroll_time_entries(timesheet_id) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION protect_reserved_time() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE target integer; BEGIN
 SELECT payroll_id INTO target FROM payroll_time_entries WHERE timesheet_id=OLD.id AND released_at IS NULL;
 IF target IS NOT NULL AND NOT (NEW.status='payroll_locked' AND NEW.payroll_id=target AND NEW.actual_start_at=OLD.actual_start_at AND NEW.actual_end_at=OLD.actual_end_at AND NEW.break_minutes=OLD.break_minutes AND NEW.payable_minutes=OLD.payable_minutes AND EXISTS(SELECT 1 FROM payroll WHERE id=target AND status='processed')) THEN RAISE EXCEPTION 'Release the payroll time import before changing this timesheet'; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER protect_reserved_time BEFORE UPDATE ON workforce_timesheets FOR EACH ROW EXECUTE FUNCTION protect_reserved_time();
--> statement-breakpoint
CREATE TABLE attendance_history(id serial PRIMARY KEY, attendance_id integer NOT NULL REFERENCES attendance(id), version integer NOT NULL, snapshot jsonb NOT NULL, actor_id integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(attendance_id,version));
--> statement-breakpoint
INSERT INTO attendance_history(attendance_id,version,snapshot) SELECT id,version,to_jsonb(attendance) FROM attendance;
--> statement-breakpoint
CREATE FUNCTION attendance_history_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO attendance_history(attendance_id,version,snapshot,actor_id) VALUES(NEW.id,NEW.version,to_jsonb(NEW),nullif(current_setting('app.attendance_actor',true),'')::integer);RETURN NEW;END $$;
--> statement-breakpoint
CREATE TRIGGER attendance_history_write AFTER INSERT OR UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION attendance_history_write();
--> statement-breakpoint
