CREATE TABLE learning_courses (id serial PRIMARY KEY,version integer NOT NULL DEFAULT 1,definition jsonb NOT NULL,created_by integer NOT NULL REFERENCES users(id),history jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE learning_enrollments (id serial PRIMARY KEY,course_id integer NOT NULL REFERENCES learning_courses(id),employee_id integer NOT NULL REFERENCES employees(id),version integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','in_progress','completion_submitted','completed','failed','withdrawn','rejected')),course_snapshot jsonb NOT NULL,due_date date,requested_by integer NOT NULL REFERENCES users(id),approver_id integer NOT NULL REFERENCES users(id),progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),completion_note text,score integer CHECK(score BETWEEN 0 AND 100),submitted_by integer REFERENCES users(id),completed_at timestamptz,expires_on date,certificate_number text UNIQUE,verified_by integer REFERENCES users(id),history jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE UNIQUE INDEX learning_active_enrollment ON learning_enrollments(employee_id,course_id) WHERE status IN ('requested','approved','in_progress','completion_submitted');
--> statement-breakpoint
CREATE TABLE service_policies (id serial PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('benefit','expense')),key text NOT NULL,name text NOT NULL,employee_id integer REFERENCES employees(id),effective_from date NOT NULL,config jsonb NOT NULL,reason text NOT NULL,created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX service_policy_lookup ON service_policies(kind,key,employee_id,effective_from DESC,id DESC);
--> statement-breakpoint
CREATE FUNCTION keep_service_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Policy revisions are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER service_policy_immutable BEFORE UPDATE OR DELETE ON service_policies FOR EACH ROW EXECUTE FUNCTION keep_service_policy();
--> statement-breakpoint
CREATE TABLE service_requests (id serial PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('benefit','expense')),policy_key text NOT NULL,employee_id integer NOT NULL REFERENCES employees(id),request_date date NOT NULL,title text NOT NULL,details text NOT NULL,amount numeric(12,2) NOT NULL CHECK(amount>0),items jsonb NOT NULL DEFAULT '[]',policy_snapshot jsonb,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','returned','rejected','cancelled','fulfilled')),version integer NOT NULL DEFAULT 1,created_by integer NOT NULL REFERENCES users(id),approver_id integer REFERENCES users(id),approved_by integer REFERENCES users(id),fulfilled_by integer REFERENCES users(id),fulfillment_reference text,fulfilled_at timestamptz,history jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX service_request_allowance ON service_requests(employee_id,kind,policy_key,request_date,status);
--> statement-breakpoint
CREATE TABLE service_files (id serial PRIMARY KEY,enrollment_id integer REFERENCES learning_enrollments(id),request_id integer REFERENCES service_requests(id),object_key text NOT NULL UNIQUE,filename text NOT NULL,size integer NOT NULL CHECK(size BETWEEN 1 AND 10485760),uploaded_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK ((enrollment_id IS NULL) <> (request_id IS NULL)));
