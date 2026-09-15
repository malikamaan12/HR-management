CREATE TABLE recruitment_handoffs (
 id serial PRIMARY KEY, offer_id integer NOT NULL UNIQUE REFERENCES job_offers(id),
 application_id integer NOT NULL UNIQUE REFERENCES job_applications(id),
 candidate_id integer NOT NULL UNIQUE REFERENCES candidates(id), employee_id integer NOT NULL UNIQUE REFERENCES employees(id),
 reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION protect_completed_handoff() RETURNS trigger AS $$
BEGIN
 IF TG_TABLE_NAME = 'job_offers' THEN
  IF EXISTS(SELECT 1 FROM recruitment_handoffs WHERE offer_id=OLD.id) THEN
   RAISE EXCEPTION 'Completed hiring handoff is immutable';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM recruitment_handoffs WHERE application_id=OLD.id) THEN
   RAISE EXCEPTION 'Completed hiring handoff is immutable';
  END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER protect_handoff_offer BEFORE UPDATE ON job_offers FOR EACH ROW EXECUTE FUNCTION protect_completed_handoff();
--> statement-breakpoint
CREATE TRIGGER protect_handoff_application BEFORE UPDATE ON job_applications FOR EACH ROW EXECUTE FUNCTION protect_completed_handoff();
