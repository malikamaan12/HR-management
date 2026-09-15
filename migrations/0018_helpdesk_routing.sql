CREATE TABLE helpdesk_routing_policies (
 id serial PRIMARY KEY, category text NOT NULL, confidential boolean NOT NULL,
 version integer NOT NULL CHECK (version > 0), assignee_id integer REFERENCES users(id),
 reason text NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamp NOT NULL DEFAULT now(),
 UNIQUE(category, confidential, version)
);
