ALTER TABLE onboarding_checklists ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
--> statement-breakpoint
ALTER TABLE checklist_tasks ADD COLUMN active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE onboarding_template_versions (
 id serial PRIMARY KEY, checklist_id integer NOT NULL REFERENCES onboarding_checklists(id),
 version integer NOT NULL, snapshot jsonb NOT NULL, created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(checklist_id,version)
);
