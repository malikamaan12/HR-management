CREATE TABLE privacy_requests (
 id serial PRIMARY KEY,version integer NOT NULL DEFAULT 1,
 employee_id integer NOT NULL REFERENCES employees(id),requested_by integer NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('access','correction','erasure','restriction')),
 details text NOT NULL,status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','in_review','fulfilled','rejected','withdrawn')),
 due_date date NOT NULL,response text,handled_by integer REFERENCES users(id),reviewed_by integer REFERENCES users(id),
 submission_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,submission_key),CHECK(reviewed_by IS NULL OR reviewed_by<>requested_by)
);
CREATE INDEX privacy_requests_queue ON privacy_requests(status,due_date,id);
