ALTER TABLE workforce_members ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
--> statement-breakpoint
CREATE TRIGGER workforce_member_version BEFORE UPDATE ON workforce_members FOR EACH ROW EXECUTE FUNCTION advance_workforce_shift_version();
--> statement-breakpoint
CREATE TABLE workforce_member_changes (
  id serial PRIMARY KEY, member_id integer NOT NULL REFERENCES workforce_members(id), actor_id integer NOT NULL REFERENCES users(id),
  version integer NOT NULL, previous_end_at timestamptz NOT NULL, end_at timestamptz NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(member_id,version)
);
--> statement-breakpoint
CREATE TABLE workforce_arrival_rules (
  id serial PRIMARY KEY, team_id integer NOT NULL REFERENCES workforce_teams(id), employee_id integer REFERENCES employees(id),
  effective_at timestamptz NOT NULL, rules jsonb NOT NULL, reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX workforce_arrival_rule_scope ON workforce_arrival_rules(team_id,employee_id,effective_at);
--> statement-breakpoint
CREATE TABLE workforce_presence (
  id serial PRIMARY KEY, assignment_id integer NOT NULL UNIQUE REFERENCES workforce_assignments(id), employee_id integer NOT NULL REFERENCES employees(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), arrived_at timestamptz NOT NULL, arrived_by integer NOT NULL REFERENCES users(id), departed_at timestamptz CHECK (departed_at >= arrived_at),
  departed_by integer REFERENCES users(id), departure_reason text, policy_snapshot jsonb NOT NULL, flags jsonb NOT NULL DEFAULT '[]',
  reviewed_at timestamptz, reviewed_by integer REFERENCES users(id), review_note text,
  CHECK ((departed_at IS NULL) = (departed_by IS NULL)),
  CHECK (reviewed_at IS NULL OR (departed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_note IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX workforce_presence_open ON workforce_presence(employee_id) WHERE departed_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER workforce_presence_version BEFORE UPDATE ON workforce_presence FOR EACH ROW EXECUTE FUNCTION advance_workforce_shift_version();
--> statement-breakpoint
CREATE TABLE workforce_incidents (
  id serial PRIMARY KEY, shift_id integer NOT NULL REFERENCES workforce_shifts(id), reporter_id integer NOT NULL REFERENCES users(id),
  request_key text NOT NULL, occurred_at timestamptz NOT NULL, title text NOT NULL, details text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high')), status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), owner_id integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reporter_id,request_key)
);
--> statement-breakpoint
CREATE INDEX workforce_incident_shift ON workforce_incidents(shift_id);
--> statement-breakpoint
CREATE TRIGGER workforce_incident_version BEFORE UPDATE ON workforce_incidents FOR EACH ROW EXECUTE FUNCTION advance_workforce_shift_version();
--> statement-breakpoint
CREATE TABLE workforce_incident_updates (
  id serial PRIMARY KEY, incident_id integer NOT NULL REFERENCES workforce_incidents(id), version integer NOT NULL,
  actor_id integer NOT NULL REFERENCES users(id), status text NOT NULL, note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(incident_id,version)
);
