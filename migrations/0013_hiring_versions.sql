ALTER TABLE job_requisitions ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE job_applications ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE job_offers ADD COLUMN version integer NOT NULL DEFAULT 1, ADD COLUMN currency text NOT NULL DEFAULT 'QAR';
--> statement-breakpoint
CREATE TRIGGER requisition_version BEFORE UPDATE ON job_requisitions FOR EACH ROW EXECUTE FUNCTION advance_attendance_version();
--> statement-breakpoint
CREATE TRIGGER application_version BEFORE UPDATE ON job_applications FOR EACH ROW EXECUTE FUNCTION advance_attendance_version();
--> statement-breakpoint
CREATE TRIGGER offer_version BEFORE UPDATE ON job_offers FOR EACH ROW EXECUTE FUNCTION advance_attendance_version();

--> statement-breakpoint
ALTER TABLE interviews ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TRIGGER interview_version BEFORE UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION advance_attendance_version();
