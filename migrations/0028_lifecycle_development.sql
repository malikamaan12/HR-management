CREATE TABLE IF NOT EXISTS lifecycle_history (
 id serial PRIMARY KEY, kind text NOT NULL, record_id integer NOT NULL, version integer NOT NULL,
 snapshot jsonb NOT NULL, actor_id integer NOT NULL REFERENCES users(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,record_id,version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS review_cycles (
 id serial PRIMARY KEY, title text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, due_date date NOT NULL,
 rubric jsonb NOT NULL, rating_max integer NOT NULL DEFAULT 5 CHECK(rating_max IN (5,10)), score_decimals integer NOT NULL DEFAULT 2 CHECK(score_decimals BETWEEN 0 AND 2), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 version integer NOT NULL DEFAULT 1, created_by integer NOT NULL REFERENCES users(id), CHECK(end_date>=start_date AND due_date>=end_date)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cycle_assessments (
 id serial PRIMARY KEY, cycle_id integer NOT NULL REFERENCES review_cycles(id), employee_id integer NOT NULL REFERENCES employees(id),
 reviewer_id integer NOT NULL REFERENCES employees(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','published')),
 version integer NOT NULL DEFAULT 1, ratings jsonb NOT NULL DEFAULT '[]', development_plan text NOT NULL DEFAULT '',
 acknowledged_at timestamptz, published_by integer REFERENCES users(id), score numeric, UNIQUE(cycle_id,employee_id), CHECK(employee_id<>reviewer_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS learning_records (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), course_id integer NOT NULL REFERENCES training_courses(id),
 course_title text NOT NULL, due_date date NOT NULL, status text NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','submitted','completed','withdrawn')),
 version integer NOT NULL DEFAULT 1, evidence text NOT NULL DEFAULT '', completion_date date, expiry_date date,
 verified_by integer REFERENCES users(id), created_by integer NOT NULL REFERENCES users(id), CHECK(expiry_date IS NULL OR expiry_date>=completion_date)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS learning_record_open ON learning_records(employee_id,course_id) WHERE status IN ('assigned','submitted');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS onboarding_document_checks (
 id serial PRIMARY KEY, onboarding_id integer NOT NULL REFERENCES employee_onboarding(id), document_type text NOT NULL,
 document_id integer REFERENCES documents(id), document_updated_at timestamp, version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'required' CHECK(status IN ('required','verified')), verified_by integer REFERENCES users(id),
 UNIQUE(onboarding_id,document_type)
);
--> statement-breakpoint
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS stage_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION advance_application_version() RETURNS trigger AS $$ BEGIN NEW.stage_version=OLD.stage_version+1; RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS advance_application_version ON job_applications;
--> statement-breakpoint
CREATE TRIGGER advance_application_version BEFORE UPDATE ON job_applications FOR EACH ROW EXECUTE FUNCTION advance_application_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_exit_history() RETURNS trigger AS $$ BEGIN
 INSERT INTO lifecycle_history(kind,record_id,version,snapshot,actor_id,reason) VALUES ('exit',NEW.id,NEW.version,to_jsonb(NEW),COALESCE(NULLIF(current_setting('app.actor_id',true),'')::integer,NEW.created_by),'Exit checklist snapshot'); RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS preserve_exit_history ON offboarding_cases;
--> statement-breakpoint
CREATE TRIGGER preserve_exit_history AFTER INSERT OR UPDATE ON offboarding_cases FOR EACH ROW EXECUTE FUNCTION preserve_exit_history();
--> statement-breakpoint
INSERT INTO lifecycle_history(kind,record_id,version,snapshot,actor_id,reason) SELECT 'exit',id,version,to_jsonb(o),created_by,'Initial snapshot at migration' FROM offboarding_cases o ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gate_onboarding_documents() RETURNS trigger AS $$ BEGIN
 IF NEW.status='completed' AND EXISTS (SELECT 1 FROM onboarding_document_checks c LEFT JOIN documents d ON d.id=c.document_id WHERE c.onboarding_id=NEW.id AND (c.status<>'verified' OR d.id IS NULL OR d.updated_at IS DISTINCT FROM c.document_updated_at OR d.expiry_date<CURRENT_DATE OR d.issue_date>CURRENT_DATE OR d.document_file IS NULL)) THEN RAISE EXCEPTION 'Verify required documents first'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS gate_onboarding_documents ON employee_onboarding;
--> statement-breakpoint
CREATE TRIGGER gate_onboarding_documents BEFORE UPDATE ON employee_onboarding FOR EACH ROW EXECUTE FUNCTION gate_onboarding_documents();
--> statement-breakpoint
ALTER TABLE employee_goals ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION advance_goal_version() RETURNS trigger AS $$ BEGIN NEW.version=OLD.version+1; RETURN NEW; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS advance_goal_version ON employee_goals;
--> statement-breakpoint
CREATE TRIGGER advance_goal_version BEFORE UPDATE ON employee_goals FOR EACH ROW EXECUTE FUNCTION advance_goal_version();
