CREATE TABLE workforce_availability_series (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), request_key text NOT NULL, pattern jsonb NOT NULL,
  created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), stopped_at timestamptz,
  stopped_by integer REFERENCES users(id), stop_reason text, UNIQUE(employee_id,request_key)
);
--> statement-breakpoint
ALTER TABLE workforce_unavailable ADD COLUMN series_id integer REFERENCES workforce_availability_series(id);
--> statement-breakpoint
CREATE INDEX workforce_unavailable_series ON workforce_unavailable(series_id);
--> statement-breakpoint
ALTER TABLE employee_qualifications ADD COLUMN renews_credential_id integer UNIQUE REFERENCES employee_qualifications(id), ADD CONSTRAINT qualification_renewal_not_self CHECK (renews_credential_id <> id);
--> statement-breakpoint
CREATE TABLE workforce_renewal_policies (
  id serial PRIMARY KEY, qualification_id integer NOT NULL REFERENCES workforce_qualifications(id), employee_id integer REFERENCES employees(id),
  effective_at timestamptz NOT NULL, config jsonb NOT NULL, reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX workforce_renewal_policy_scope ON workforce_renewal_policies(qualification_id,employee_id,effective_at);
--> statement-breakpoint
CREATE TABLE workforce_renewals (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), previous_credential_id integer NOT NULL REFERENCES employee_qualifications(id),
  request_key text NOT NULL, submitted_by integer NOT NULL REFERENCES users(id), reference text NOT NULL, note text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','returned','verified','cancelled')), version integer NOT NULL DEFAULT 1 CHECK (version>0),
  policy_snapshot jsonb NOT NULL, reviewed_by integer REFERENCES users(id), reviewed_at timestamptz, review_note text,
  new_credential_id integer UNIQUE REFERENCES employee_qualifications(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id,request_key), CHECK ((status='verified')=(new_credential_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX workforce_renewal_pending ON workforce_renewals(previous_credential_id) WHERE status IN ('submitted','returned');
--> statement-breakpoint
CREATE TRIGGER workforce_renewal_version BEFORE UPDATE ON workforce_renewals FOR EACH ROW EXECUTE FUNCTION advance_workforce_shift_version();
--> statement-breakpoint
CREATE TABLE workforce_renewal_history (
  id serial PRIMARY KEY, renewal_id integer NOT NULL REFERENCES workforce_renewals(id), version integer NOT NULL, actor_id integer NOT NULL REFERENCES users(id),
  action text NOT NULL, reason text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(renewal_id,version)
);
