CREATE TABLE report_correction_history (id serial PRIMARY KEY,kind text NOT NULL,record_id integer NOT NULL,version integer NOT NULL,snapshot jsonb NOT NULL,actor_id integer NOT NULL REFERENCES users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,record_id,version));
--> statement-breakpoint
CREATE TABLE report_runs (
 id serial PRIMARY KEY, owner_id integer NOT NULL REFERENCES users(id), request_key uuid NOT NULL,
 report_type text NOT NULL, filters jsonb NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,request_key)
);
--> statement-breakpoint
CREATE INDEX report_runs_owner_recent ON report_runs(owner_id,id DESC);
--> statement-breakpoint
CREATE TABLE reporting_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE,
 turnover_denominator text NOT NULL CHECK(turnover_denominator IN ('opening','average_endpoints')),
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE candidates ADD COLUMN record_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE FUNCTION guard_candidate_correction() RETURNS trigger AS $$
BEGIN
 IF (NEW.full_name_en,NEW.full_name_ar,NEW.qid_number) IS DISTINCT FROM (OLD.full_name_en,OLD.full_name_ar,OLD.qid_number)
 AND EXISTS(SELECT 1 FROM job_offers o JOIN job_applications a ON a.id=o.application_id WHERE a.candidate_id=OLD.id) THEN
  RAISE EXCEPTION 'Candidate identity is frozen once an offer exists' USING ERRCODE='23514';
 END IF;
 NEW.record_version=OLD.record_version+1;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER candidate_correction_guard BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION guard_candidate_correction();
--> statement-breakpoint
CREATE FUNCTION lock_offer_candidate() RETURNS trigger AS $$
BEGIN
 PERFORM c.id FROM candidates c JOIN job_applications a ON a.candidate_id=c.id WHERE a.id=NEW.application_id FOR UPDATE OF c;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offer_candidate_lock BEFORE INSERT OR UPDATE OF application_id ON job_offers FOR EACH ROW EXECUTE FUNCTION lock_offer_candidate();
