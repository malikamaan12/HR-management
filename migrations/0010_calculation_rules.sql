CREATE TABLE calculation_rule_versions (
 id serial PRIMARY KEY,
 scope text NOT NULL CHECK (scope IN ('default','management_office','shift_based')),
 effective_from date NOT NULL,
 rules jsonb NOT NULL,
 reason text NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX calculation_rule_lookup ON calculation_rule_versions(scope,effective_from DESC,id DESC);
--> statement-breakpoint
CREATE FUNCTION keep_calculation_rule_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Published calculation rules are immutable; publish a new version';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_calculation_rules BEFORE UPDATE OR DELETE ON calculation_rule_versions
 FOR EACH ROW EXECUTE FUNCTION keep_calculation_rule_version();
--> statement-breakpoint
ALTER TABLE attendance ADD COLUMN calculation_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE leaves ADD COLUMN calculation_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE payroll ADD COLUMN calculation_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE payroll ADD COLUMN rounding_adjustment_cents integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE workforce_timesheets ADD COLUMN calculation_snapshot jsonb;
