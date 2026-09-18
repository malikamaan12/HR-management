CREATE TABLE IF NOT EXISTS employee_service_policies (
 id serial PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('expense','benefit')), name text NOT NULL,
 version integer NOT NULL, enabled boolean NOT NULL, rules jsonb NOT NULL, created_by integer NOT NULL REFERENCES users(id),
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,name,version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employee_service_requests (
 id serial PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('expense','benefit')), employee_id integer NOT NULL REFERENCES employees(id),
 policy_id integer NOT NULL REFERENCES employee_service_policies(id), title text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents>0),
 service_date date NOT NULL, end_date date, evidence text NOT NULL, reference text NOT NULL, status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','withdrawn','paid','ended')),
 version integer NOT NULL DEFAULT 1, created_by integer NOT NULL REFERENCES users(id), decided_by integer REFERENCES users(id), payment_reference text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(employee_id,kind,reference), CHECK(end_date IS NULL OR end_date>=service_date)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS helpdesk_reminder_policy (
 id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL DEFAULT 1, enabled boolean NOT NULL DEFAULT false,
 escalate boolean NOT NULL DEFAULT false, actor_id integer NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS helpdesk_reminders (
 id serial PRIMARY KEY, case_id integer NOT NULL REFERENCES helpdesk_cases(id), user_id integer NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('response','resolution')), deadline timestamptz NOT NULL, read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id,user_id,kind,deadline)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS eos_service_keys (
 id serial PRIMARY KEY, name text NOT NULL, team_id integer NOT NULL REFERENCES workforce_teams(id), key_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS eos_activation_links (
 id serial PRIMARY KEY, team_id integer NOT NULL REFERENCES workforce_teams(id), external_id text NOT NULL,
 label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(team_id,external_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS eos_requests (
 id serial PRIMARY KEY, key_id integer NOT NULL REFERENCES eos_service_keys(id), request_key text NOT NULL,
 body_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(key_id,request_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS eos_assignment_events (id serial PRIMARY KEY,team_id integer NOT NULL REFERENCES workforce_teams(id),assignment_id integer NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION capture_eos_assignment() RETURNS trigger AS $$ DECLARE team integer; BEGIN
 PERFORM pg_advisory_xact_lock(293004);
 SELECT team_id INTO team FROM workforce_shifts WHERE id=NEW.shift_id;
 INSERT INTO eos_assignment_events(team_id,assignment_id,payload) VALUES (team,NEW.id,jsonb_build_object('assignmentId',NEW.id,'shiftId',NEW.shift_id,'employeeId',NEW.employee_id,'status',NEW.status)); RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS capture_eos_assignment ON workforce_assignments;
--> statement-breakpoint
CREATE TRIGGER capture_eos_assignment AFTER INSERT OR UPDATE ON workforce_assignments FOR EACH ROW EXECUTE FUNCTION capture_eos_assignment();
--> statement-breakpoint
INSERT INTO eos_assignment_events(team_id,assignment_id,payload) SELECT s.team_id,a.id,jsonb_build_object('assignmentId',a.id,'shiftId',a.shift_id,'employeeId',a.employee_id,'status',a.status) FROM workforce_assignments a JOIN workforce_shifts s ON s.id=a.shift_id WHERE NOT EXISTS(SELECT 1 FROM eos_assignment_events e WHERE e.assignment_id=a.id);
