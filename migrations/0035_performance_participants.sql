CREATE TABLE performance_participation (
  assessment_id integer PRIMARY KEY REFERENCES performance_assessments(id),
  status text NOT NULL CHECK (status IN ('active','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reason text NOT NULL, changed_by integer NOT NULL REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX performance_participation_withdrawn ON performance_participation(assessment_id) WHERE status='withdrawn';
