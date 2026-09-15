CREATE TABLE performance_cycles (
 id serial PRIMARY KEY, name text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, due_date date NOT NULL,
 self_required boolean NOT NULL, rubric jsonb NOT NULL, rating_labels jsonb NOT NULL, status text NOT NULL DEFAULT 'draft', version integer NOT NULL DEFAULT 1,
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (period_start <= period_end AND period_end <= due_date), CHECK (status IN ('draft','open','closed','cancelled')), CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE performance_assessments (
 id serial PRIMARY KEY, cycle_id integer NOT NULL REFERENCES performance_cycles(id), employee_id integer NOT NULL REFERENCES employees(id), reviewer_id integer NOT NULL REFERENCES users(id),
 due_date date NOT NULL, self_required boolean NOT NULL, status text NOT NULL DEFAULT 'pending', version integer NOT NULL DEFAULT 1,
 self_scores jsonb, self_summary text, manager_scores jsonb, manager_summary text, final_scores jsonb, final_summary text, final_rating numeric(4,2),
 calibrated_by integer REFERENCES users(id), published_at timestamptz, acknowledged_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT performance_cycle_employee UNIQUE (cycle_id, employee_id), CHECK (version > 0), CHECK (final_rating BETWEEN 1 AND 5),
 CHECK (status IN ('pending','self_review','manager_review','calibration','published','acknowledged'))
);
--> statement-breakpoint
CREATE INDEX performance_assessment_reviewer ON performance_assessments(reviewer_id, status);
--> statement-breakpoint
CREATE TABLE performance_objectives (
 id serial PRIMARY KEY, assessment_id integer NOT NULL REFERENCES performance_assessments(id), kind text NOT NULL, title text NOT NULL, measure text NOT NULL, due_date date NOT NULL,
 progress integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1, created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (kind IN ('objective','development')), CHECK (status IN ('active','completed','cancelled')), CHECK (progress BETWEEN 0 AND 100), CHECK (status <> 'completed' OR progress = 100), CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX performance_objective_assessment ON performance_objectives(assessment_id);
--> statement-breakpoint
CREATE TABLE performance_history (
 id serial PRIMARY KEY, cycle_id integer NOT NULL REFERENCES performance_cycles(id), assessment_id integer REFERENCES performance_assessments(id), actor_id integer NOT NULL REFERENCES users(id),
 action text NOT NULL, reason text, snapshot jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX performance_history_assessment ON performance_history(assessment_id, id);
--> statement-breakpoint
ALTER TABLE helpdesk_cases ADD COLUMN policy_snapshot jsonb, ADD COLUMN first_response_due_at timestamptz, ADD COLUMN resolution_due_at timestamptz,
 ADD COLUMN first_responded_at timestamptz, ADD COLUMN resolved_at timestamptz, ADD COLUMN escalated_at timestamptz;
--> statement-breakpoint
CREATE TABLE helpdesk_policies (
 id serial PRIMARY KEY, category text NOT NULL, confidential boolean NOT NULL, employee_id integer REFERENCES employees(id), enabled boolean NOT NULL, effective_at timestamptz NOT NULL,
 first_response_hours integer NOT NULL, resolution_hours integer NOT NULL, default_assignee_id integer REFERENCES users(id), escalation_assignee_id integer REFERENCES users(id),
 reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (first_response_hours BETWEEN 1 AND 8760), CHECK (resolution_hours BETWEEN first_response_hours AND 8760)
);
--> statement-breakpoint
CREATE INDEX helpdesk_policy_lookup ON helpdesk_policies(category, confidential, employee_id, effective_at, id);
--> statement-breakpoint
CREATE TABLE helpdesk_articles (
 id serial PRIMARY KEY, title text NOT NULL, body text NOT NULL, category text NOT NULL, audience text NOT NULL, status text NOT NULL DEFAULT 'draft', version integer NOT NULL DEFAULT 1,
 created_by integer NOT NULL REFERENCES users(id), published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (audience IN ('all','hr')), CHECK (status IN ('draft','published','archived')), CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE helpdesk_article_history (
 id serial PRIMARY KEY, article_id integer NOT NULL REFERENCES helpdesk_articles(id), version integer NOT NULL, actor_id integer NOT NULL REFERENCES users(id),
 reason text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT helpdesk_article_revision UNIQUE(article_id, version)
);
