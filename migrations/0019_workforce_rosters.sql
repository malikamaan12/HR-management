CREATE TABLE workforce_series (
  id serial PRIMARY KEY, team_id integer NOT NULL REFERENCES workforce_teams(id),
  request_key text NOT NULL, definition jsonb NOT NULL, timezone text NOT NULL,
  created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX workforce_series_request ON workforce_series(team_id, request_key);
--> statement-breakpoint
ALTER TABLE workforce_shifts ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','replaced')),
  ADD COLUMN series_id integer REFERENCES workforce_series(id),
  ADD COLUMN replaces_id integer UNIQUE REFERENCES workforce_shifts(id),
  ADD COLUMN replacement_id integer UNIQUE REFERENCES workforce_shifts(id),
  ADD COLUMN change_reason text;
--> statement-breakpoint
CREATE FUNCTION advance_workforce_shift_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workforce_shift_version BEFORE UPDATE ON workforce_shifts FOR EACH ROW EXECUTE FUNCTION advance_workforce_shift_version();
--> statement-breakpoint
CREATE TABLE workforce_shift_changes (
  id serial PRIMARY KEY, shift_id integer NOT NULL REFERENCES workforce_shifts(id),
  actor_id integer NOT NULL REFERENCES users(id), reason text NOT NULL, snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
