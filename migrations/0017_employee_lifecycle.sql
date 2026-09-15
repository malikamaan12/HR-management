CREATE TABLE hiring_handoffs (offer_id integer PRIMARY KEY REFERENCES job_offers(id),candidate_id integer NOT NULL UNIQUE REFERENCES candidates(id),employee_id integer NOT NULL UNIQUE REFERENCES employees(id),created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE lifecycle_templates (id serial PRIMARY KEY,name text NOT NULL,kind text NOT NULL CHECK(kind IN ('onboarding','offboarding')),tasks jsonb NOT NULL,created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE lifecycle_cases (id serial PRIMARY KEY,employee_id integer NOT NULL REFERENCES employees(id),kind text NOT NULL CHECK(kind IN ('onboarding','offboarding')),template_id integer NOT NULL REFERENCES lifecycle_templates(id),template_snapshot jsonb NOT NULL,start_date date NOT NULL,status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','cancelled')),version integer NOT NULL DEFAULT 1,created_by integer NOT NULL REFERENCES users(id),reason text NOT NULL,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE UNIQUE INDEX lifecycle_active_case ON lifecycle_cases(employee_id,kind) WHERE status='in_progress';
--> statement-breakpoint
CREATE TABLE lifecycle_tasks (id serial PRIMARY KEY,case_id integer NOT NULL REFERENCES lifecycle_cases(id),title text NOT NULL,kind text NOT NULL CHECK(kind IN ('general','document','asset_return')),required boolean NOT NULL,owner_id integer NOT NULL REFERENCES users(id),due_date date NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),evidence text,document_id integer REFERENCES documents(id),asset_tag text,completed_by integer REFERENCES users(id),completed_at timestamptz);
--> statement-breakpoint
CREATE INDEX lifecycle_task_owner ON lifecycle_tasks(owner_id,case_id);
