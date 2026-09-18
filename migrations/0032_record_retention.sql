CREATE TABLE hr_retention_policies (
 id serial PRIMARY KEY, document_type text NOT NULL UNIQUE, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 enabled boolean NOT NULL DEFAULT false, anchor text NOT NULL CHECK(anchor IN ('expiry','employment_end')),
 retention_days integer NOT NULL CHECK(retention_days BETWEEN 0 AND 36500), review_days integer NOT NULL CHECK(review_days BETWEEN 1 AND 365),
 updated_by integer NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE hr_retention_holds (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), document_id integer REFERENCES documents(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), active boolean NOT NULL DEFAULT true, reason text NOT NULL,
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 released_by integer REFERENCES users(id), released_at timestamptz, release_reason text
);
--> statement-breakpoint
CREATE INDEX hr_retention_hold_lookup ON hr_retention_holds(employee_id,document_id) WHERE active;
--> statement-breakpoint
CREATE TABLE hr_document_archives (
 id serial PRIMARY KEY, document_id integer NOT NULL UNIQUE REFERENCES documents(id), employee_id integer NOT NULL REFERENCES employees(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL, changed_by integer NOT NULL REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE hr_retention_requests (
 id serial PRIMARY KEY, document_id integer NOT NULL REFERENCES documents(id), employee_id integer NOT NULL REFERENCES employees(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), action text NOT NULL CHECK(action IN ('archive','restore')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
 requested_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, document_snapshot jsonb NOT NULL, policy_snapshot jsonb,
 review_due_date date NOT NULL, decided_by integer REFERENCES users(id), decided_at timestamptz, decision_reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_retention_pending_document ON hr_retention_requests(document_id) WHERE status='pending';
--> statement-breakpoint
CREATE INDEX hr_retention_request_queue ON hr_retention_requests(status,review_due_date,id);
