CREATE TABLE document_renewal_requests (
  id serial PRIMARY KEY,
  document_id integer NOT NULL REFERENCES documents(id),
  requested_by integer NOT NULL REFERENCES users(id),
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  proposal jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  review_reason text,
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK ((status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX document_renewal_pending ON document_renewal_requests(document_id) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX document_renewal_created ON document_renewal_requests(created_at);
