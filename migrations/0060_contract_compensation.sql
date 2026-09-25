CREATE TABLE contract_compensation_proposals (
 id serial PRIMARY KEY,
 contract_id integer NOT NULL REFERENCES employee_contracts(id),
 employee_id integer NOT NULL REFERENCES employees(id),
 contract_hash text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')),
 expected_package_version integer NOT NULL CHECK(expected_package_version>=0),
 effective_from date NOT NULL,
 definition jsonb NOT NULL,
 reason text NOT NULL,
 prepared_by integer NOT NULL REFERENCES users(id),
 submission_key uuid NOT NULL,
 reviewed_by integer REFERENCES users(id),
 review_reason text,
 reviewed_at timestamptz,
 package_id integer UNIQUE REFERENCES employee_compensation_packages(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(prepared_by,submission_key),
 CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by),
 CHECK(status='pending' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL)),
 CHECK((status='applied')=(package_id IS NOT NULL))
);
CREATE UNIQUE INDEX contract_compensation_open ON contract_compensation_proposals(contract_id) WHERE status IN ('pending','applied');
CREATE INDEX contract_compensation_employee ON contract_compensation_proposals(employee_id,id);
CREATE FUNCTION protect_contract_compensation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Contract compensation evidence must be retained'; END IF;
 IF OLD.status<>'pending' OR NEW.status NOT IN ('applied','rejected') OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'A pending mapping requires a versioned review decision'; END IF;
 IF (to_jsonb(NEW)-ARRAY['version','status','reviewed_by','review_reason','reviewed_at','package_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','status','reviewed_by','review_reason','reviewed_at','package_id']) THEN RAISE EXCEPTION 'Review cannot rewrite proposed contract compensation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contract_compensation_immutable BEFORE UPDATE OR DELETE ON contract_compensation_proposals FOR EACH ROW EXECUTE FUNCTION protect_contract_compensation();
