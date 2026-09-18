ALTER TABLE workforce_series ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
--> statement-breakpoint
CREATE TABLE workforce_renewal_evidence (
 renewal_id integer PRIMARY KEY REFERENCES workforce_renewals(id), document_id integer NOT NULL REFERENCES documents(id),
 snapshot jsonb NOT NULL, attached_by integer NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX workforce_renewal_evidence_document ON workforce_renewal_evidence(document_id);
