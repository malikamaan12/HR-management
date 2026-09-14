CREATE TABLE document_versions (
  id serial PRIMARY KEY,
  document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_document_version UNIQUE (document_id,version)
);
--> statement-breakpoint
CREATE INDEX document_versions_document_created ON document_versions(document_id,created_at);
