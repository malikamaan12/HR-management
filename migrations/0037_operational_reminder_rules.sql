CREATE TABLE operational_reminder_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0), config jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE operational_reminder_deliveries (
 id serial PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('document_expiry','training_completion','handbook_due','equipment_due','approval_reminder')),
 record_id integer NOT NULL, recipient_id integer NOT NULL REFERENCES users(id), target_date text NOT NULL DEFAULT '',
 period_key varchar(80) NOT NULL, policy_version integer NOT NULL, notification_id integer REFERENCES notifications(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,record_id,recipient_id,target_date,period_key)
);
--> statement-breakpoint
CREATE INDEX operational_reminder_repeat_lookup ON operational_reminder_deliveries(kind,record_id,recipient_id,target_date,created_at DESC);
--> statement-breakpoint
CREATE TABLE operational_reminder_runtime (
 id integer PRIMARY KEY CHECK(id=1), last_started_at timestamptz, last_finished_at timestamptz,
 policy_version integer NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT false,
 notifications_created integer NOT NULL DEFAULT 0, summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
INSERT INTO operational_reminder_runtime(id) VALUES(1);
