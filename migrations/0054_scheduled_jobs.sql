CREATE TABLE scheduled_job_runtime (
 name text PRIMARY KEY CHECK(name IN ('helpdesk','reminders','reports')),
 next_run_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_until timestamptz,
 last_started_at timestamptz,
 last_finished_at timestamptz,
 last_status text CHECK(last_status IN ('running','succeeded','failed')),
 consecutive_failures integer NOT NULL DEFAULT 0
);
INSERT INTO scheduled_job_runtime(name) VALUES('helpdesk'),('reminders'),('reports');
