ALTER TABLE job_requisitions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS approved_by_user integer REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION advance_workflow_version() RETURNS trigger AS $$ BEGIN NEW.version=OLD.version+1; RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS advance_workflow_version ON job_requisitions;
--> statement-breakpoint
CREATE TRIGGER advance_workflow_version BEFORE UPDATE ON job_requisitions FOR EACH ROW EXECUTE FUNCTION advance_workflow_version();
--> statement-breakpoint
DROP TRIGGER IF EXISTS advance_workflow_version ON job_offers;
--> statement-breakpoint
CREATE TRIGGER advance_workflow_version BEFORE UPDATE ON job_offers FOR EACH ROW EXECUTE FUNCTION advance_workflow_version();
--> statement-breakpoint
DROP TRIGGER IF EXISTS advance_workflow_version ON training_courses;
--> statement-breakpoint
CREATE TRIGGER advance_workflow_version BEFORE UPDATE ON training_courses FOR EACH ROW EXECUTE FUNCTION advance_workflow_version();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS onboarding_requirement_templates (
 id serial PRIMARY KEY, checklist_id integer NOT NULL REFERENCES onboarding_checklists(id), version integer NOT NULL,
 document_types jsonb NOT NULL, created_by integer NOT NULL REFERENCES users(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(checklist_id,version)
);
--> statement-breakpoint
ALTER TABLE employee_onboarding ADD COLUMN IF NOT EXISTS requirement_template_id integer REFERENCES onboarding_requirement_templates(id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS requisition_editors (requisition_id integer NOT NULL REFERENCES job_requisitions(id),user_id integer NOT NULL REFERENCES users(id),PRIMARY KEY(requisition_id,user_id));
