CREATE TABLE helpdesk_automation_policies (id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0), config jsonb NOT NULL, created_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE helpdesk_cases ADD COLUMN automation_snapshot jsonb, ADD COLUMN automation_cycle integer NOT NULL DEFAULT 1 CHECK(automation_cycle>0), ADD COLUMN automation_next_check_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX helpdesk_automation_due ON helpdesk_cases(automation_next_check_at) WHERE status NOT IN ('resolved','closed') AND automation_snapshot IS NOT NULL;
--> statement-breakpoint
CREATE TABLE helpdesk_automation_deliveries (id serial PRIMARY KEY, case_id integer NOT NULL REFERENCES helpdesk_cases(id), cycle integer NOT NULL, kind text NOT NULL, target_due_at timestamptz NOT NULL, occurrence integer NOT NULL CHECK(occurrence>0), recipient_id integer NOT NULL REFERENCES users(id), notification_id integer REFERENCES notifications(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id,cycle,kind,target_due_at,occurrence,recipient_id));
--> statement-breakpoint
CREATE TABLE helpdesk_automation_events (id serial PRIMARY KEY, case_id integer NOT NULL REFERENCES helpdesk_cases(id), cycle integer NOT NULL, kind text NOT NULL, details text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id,cycle,kind));
--> statement-breakpoint
CREATE TABLE helpdesk_automation_runtime (id integer PRIMARY KEY CHECK(id=1), last_started_at timestamptz, last_finished_at timestamptz, cases_checked integer NOT NULL DEFAULT 0, notifications_created integer NOT NULL DEFAULT 0, cases_escalated integer NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT false);
--> statement-breakpoint
INSERT INTO helpdesk_automation_runtime(id) VALUES(1);
