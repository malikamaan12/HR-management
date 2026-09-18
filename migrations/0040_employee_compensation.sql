CREATE TABLE employee_compensation_packages (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id),
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  definition jsonb NOT NULL,
  reason text NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, version)
);
--> statement-breakpoint
CREATE INDEX employee_compensation_effective ON employee_compensation_packages(employee_id, effective_from DESC, version DESC);
--> statement-breakpoint
CREATE FUNCTION keep_employee_compensation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Compensation revisions are immutable; create a new dated revision'; END $$;
--> statement-breakpoint
CREATE TRIGGER employee_compensation_immutable BEFORE UPDATE OR DELETE ON employee_compensation_packages FOR EACH ROW EXECUTE FUNCTION keep_employee_compensation_revision();
--> statement-breakpoint
CREATE TABLE employee_compensation_payroll_links (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES employee_compensation_packages(id),
  rule_id integer NOT NULL REFERENCES hr_rules(id),
  created_by integer NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id), UNIQUE(rule_id)
);
