CREATE TABLE IF NOT EXISTS onboarding_review_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE, owner_groups jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'not_required' CHECK(review_state IN ('not_required','required','pending','returned','approved'));
--> statement-breakpoint
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS review_policy_id integer REFERENCES onboarding_review_policies(id);
--> statement-breakpoint
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS submitted_by integer REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS reviewed_by integer REFERENCES users(id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gate_onboarding_task_review() RETURNS trigger AS $$ BEGIN
 IF NEW.review_required AND NEW.status='completed' AND (NEW.review_state<>'approved' OR NEW.reviewed_by IS NULL OR NEW.submitted_by IS NULL OR NEW.reviewed_by=NEW.submitted_by) THEN RAISE EXCEPTION 'Independent onboarding task review required'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS gate_onboarding_task_review ON onboarding_tasks;
--> statement-breakpoint
CREATE TRIGGER gate_onboarding_task_review BEFORE INSERT OR UPDATE ON onboarding_tasks FOR EACH ROW EXECUTE FUNCTION gate_onboarding_task_review();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gate_onboarding_review_completion() RETURNS trigger AS $$ BEGIN
 IF NEW.status='completed' AND EXISTS(SELECT 1 FROM onboarding_tasks t WHERE t.onboarding_id=NEW.id AND t.review_required AND (t.status<>'completed' OR t.review_state<>'approved')) THEN RAISE EXCEPTION 'Finish required task reviews first'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS gate_onboarding_review_completion ON employee_onboarding;
--> statement-breakpoint
CREATE TRIGGER gate_onboarding_review_completion BEFORE UPDATE ON employee_onboarding FOR EACH ROW EXECUTE FUNCTION gate_onboarding_review_completion();
