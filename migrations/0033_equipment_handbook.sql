CREATE TABLE IF NOT EXISTS equipment_assets (
 id serial PRIMARY KEY, asset_tag text NOT NULL UNIQUE, name text NOT NULL, category text NOT NULL, serial_number text NOT NULL DEFAULT '', location text NOT NULL,
 status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','maintenance','retired','lost')), version integer NOT NULL DEFAULT 1,
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS equipment_custody (
 id serial PRIMARY KEY, asset_id integer NOT NULL REFERENCES equipment_assets(id), employee_id integer NOT NULL REFERENCES employees(id),
 asset_snapshot jsonb NOT NULL, issued_date date NOT NULL, due_date date NOT NULL, issued_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','return_requested','closed')), version integer NOT NULL DEFAULT 1,
 receipt_at timestamptz, employee_note text NOT NULL DEFAULT '', issue_evidence text NOT NULL, return_evidence text, returned_date date,
 disposition text CHECK(disposition IN ('available','maintenance','lost')), closed_by integer REFERENCES users(id), CHECK(due_date>=issued_date)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS equipment_active_custody ON equipment_custody(asset_id) WHERE status<>'closed';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS handbook_policies (
 id serial PRIMARY KEY, title text NOT NULL, body text NOT NULL, employee_types jsonb NOT NULL, department text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','withdrawn')), version integer NOT NULL DEFAULT 1,
 due_date date NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS handbook_assignments (
 id serial PRIMARY KEY, policy_id integer NOT NULL REFERENCES handbook_policies(id), policy_version integer NOT NULL,
 employee_id integer NOT NULL REFERENCES employees(id), due_date date NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')), acknowledged_at timestamptz, acknowledged_by integer REFERENCES users(id),
 UNIQUE(policy_id,policy_version,employee_id)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gate_offboarding_equipment() RETURNS trigger AS $$ BEGIN
 IF NEW.status='completed' AND EXISTS(SELECT 1 FROM equipment_custody c WHERE c.employee_id=NEW.employee_id AND c.status<>'closed') THEN RAISE EXCEPTION 'Resolve outstanding equipment custody first'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS gate_offboarding_equipment ON offboarding_cases;
--> statement-breakpoint
CREATE TRIGGER gate_offboarding_equipment BEFORE UPDATE ON offboarding_cases FOR EACH ROW EXECUTE FUNCTION gate_offboarding_equipment();
