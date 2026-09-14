ALTER TABLE workforce_shifts
  ADD COLUMN IF NOT EXISTS required_skills integer[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS workforce_shift_required_skills
  ON workforce_shifts USING gin (required_skills);
