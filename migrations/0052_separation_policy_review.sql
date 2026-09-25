ALTER TABLE separation_policies ADD COLUMN effective_from date NOT NULL DEFAULT '0001-01-01';
CREATE TABLE separation_policy_proposals (
 id serial PRIMARY KEY, version integer NOT NULL DEFAULT 1,
 base_version integer NOT NULL CHECK(base_version>=0), definition jsonb NOT NULL,
 effective_from date NOT NULL, legal_basis text NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 proposed_by integer NOT NULL REFERENCES users(id), reviewed_by integer REFERENCES users(id),
 review_reason text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by),
 CHECK(status='pending' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX separation_proposal_pending ON separation_policy_proposals(status,id);
CREATE FUNCTION protect_separation_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published policies are immutable; propose a new version'; END $$;
CREATE TRIGGER separation_policy_immutable BEFORE UPDATE OR DELETE ON separation_policies FOR EACH ROW EXECUTE FUNCTION protect_separation_policy();
