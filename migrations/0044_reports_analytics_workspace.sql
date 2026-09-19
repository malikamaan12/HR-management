ALTER TABLE reporting_policies ADD COLUMN config jsonb NOT NULL DEFAULT '{"maxRows":5000,"minimumPerformanceSample":5,"schedulesEnabled":true}'::jsonb;
--> statement-breakpoint
ALTER TABLE report_runs ADD COLUMN access_stamp text;
--> statement-breakpoint
CREATE TABLE analytics_views (
 id serial PRIMARY KEY,owner_id integer NOT NULL REFERENCES users(id),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 definition jsonb NOT NULL,archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_views_owner ON analytics_views(owner_id,id DESC);
--> statement-breakpoint
CREATE TABLE analytics_schedules (
 id serial PRIMARY KEY,owner_id integer NOT NULL REFERENCES users(id),version integer NOT NULL DEFAULT 1 CHECK(version>0),definition jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT false,last_period text,last_run_id integer REFERENCES report_runs(id),last_attempt_at timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_schedules_owner ON analytics_schedules(owner_id,id DESC);
--> statement-breakpoint
CREATE TABLE analytics_schedule_runs (
 id serial PRIMARY KEY,schedule_id integer NOT NULL REFERENCES analytics_schedules(id),period_key text NOT NULL,report_run_id integer REFERENCES report_runs(id),
 status text NOT NULL CHECK(status IN ('completed','failed')),error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,period_key)
);
--> statement-breakpoint
CREATE FUNCTION preserve_report_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Saved report snapshots are immutable'; END $$;
CREATE TRIGGER report_run_immutable BEFORE UPDATE OR DELETE ON report_runs FOR EACH ROW EXECUTE FUNCTION preserve_report_run();
