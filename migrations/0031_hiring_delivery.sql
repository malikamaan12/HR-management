ALTER TABLE interviews ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 480);
--> statement-breakpoint
DROP TRIGGER IF EXISTS advance_workflow_version ON interviews;
--> statement-breakpoint
CREATE TRIGGER advance_workflow_version BEFORE UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION advance_workflow_version();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS offer_editors (offer_id integer NOT NULL REFERENCES job_offers(id),user_id integer NOT NULL REFERENCES users(id),PRIMARY KEY(offer_id,user_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS onboarding_waiver_policies (id serial PRIMARY KEY,version integer NOT NULL UNIQUE,document_types jsonb NOT NULL,created_by integer NOT NULL REFERENCES users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE onboarding_document_checks DROP CONSTRAINT IF EXISTS onboarding_document_checks_status_check;
--> statement-breakpoint
ALTER TABLE onboarding_document_checks ADD CONSTRAINT onboarding_document_checks_status_check CHECK(status IN ('required','verified','waived'));
--> statement-breakpoint
ALTER TABLE onboarding_document_checks ADD COLUMN IF NOT EXISTS waiver_policy_id integer REFERENCES onboarding_waiver_policies(id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gate_onboarding_documents() RETURNS trigger AS $$ BEGIN
 IF NEW.status='completed' AND EXISTS (SELECT 1 FROM onboarding_document_checks c LEFT JOIN documents d ON d.id=c.document_id WHERE c.onboarding_id=NEW.id AND c.status<>'waived' AND (c.status<>'verified' OR d.id IS NULL OR d.updated_at IS DISTINCT FROM c.document_updated_at OR d.expiry_date<CURRENT_DATE OR d.issue_date>CURRENT_DATE OR d.document_file IS NULL)) THEN RAISE EXCEPTION 'Verify required documents first'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
