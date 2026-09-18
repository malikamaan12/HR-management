ALTER TABLE leaves ALTER COLUMN total_days TYPE double precision USING total_days::double precision;
--> statement-breakpoint
ALTER TABLE leaves ADD COLUMN review_version integer NOT NULL DEFAULT 1 CHECK(review_version>0), ADD COLUMN approval_stage integer NOT NULL DEFAULT 0 CHECK(approval_stage>=0);
--> statement-breakpoint
ALTER TABLE leave_snapshots ADD COLUMN approval_chain jsonb NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN day_portion text NOT NULL DEFAULT 'full' CHECK(day_portion IN ('full','first_half','second_half'));
--> statement-breakpoint
CREATE TABLE hr_leave_stage_decisions (
 id serial PRIMARY KEY,leave_id integer NOT NULL REFERENCES leaves(id),stage integer NOT NULL CHECK(stage>=0),
 actor_id integer NOT NULL REFERENCES users(id),decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(leave_id,stage)
);
