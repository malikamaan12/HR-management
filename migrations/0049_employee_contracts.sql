CREATE TABLE contract_clauses (
  id serial PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO contract_clauses(title,category,body) VALUES
('Role and duties','Employment','{{employee_name}} will work as {{position}} in {{department}}. The duties and reporting arrangements agreed for this position are set out in this contract.'),
('Work location','Employment','The employee''s agreed work location is {{location}}. Any additional location or assignment conditions must be specified in this contract.'),
('Company procedures','Workplace','The employee will be provided with the company procedures and workplace instructions applicable to the role. HR will explain any updates that affect the employee.'),
('Company property','Workplace','Company property issued to the employee will be recorded and must be returned through the company''s documented handover process.'),
('Contract changes','Administration','Any proposed change to the agreed terms must be documented and provided to the employee for review. A signed copy of this version remains available in the employee''s account.');

CREATE TABLE employee_contracts (
  id serial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  employee_id integer NOT NULL REFERENCES employees(id),
  source_id integer REFERENCES employee_contracts(id),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','signed','declined','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  document jsonb NOT NULL,
  content_hash text,
  created_by integer NOT NULL REFERENCES users(id),
  submission_key uuid NOT NULL,
  sent_by integer REFERENCES users(id),
  sent_to_user_id integer REFERENCES users(id),
  sent_at timestamptz,
  signature jsonb,
  signed_by integer REFERENCES users(id),
  signed_at timestamptz,
  response_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(created_by,submission_key),
  CHECK(status='draft' OR (content_hash IS NOT NULL AND sent_by IS NOT NULL AND sent_to_user_id IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK(status<>'signed' OR (signature IS NOT NULL AND signed_by IS NOT NULL AND signed_by=sent_to_user_id AND signed_at IS NOT NULL)),
  CHECK(status='signed' OR (signature IS NULL AND signed_by IS NULL AND signed_at IS NULL)),
  CHECK(signed_by IS NULL OR (status='signed' AND signed_by<>sent_by))
);
CREATE INDEX employee_contract_employee_status ON employee_contracts(employee_id,status,id);
CREATE INDEX employee_contract_status ON employee_contracts(status,id);
CREATE FUNCTION protect_employee_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Contract records must be retained'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'A contract update requires a new version'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Contract creation time is immutable'; END IF;
  IF OLD.status<>'draft' AND (
    NEW.document IS DISTINCT FROM OLD.document OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
    NEW.employee_id<>OLD.employee_id OR NEW.reference<>OLD.reference OR NEW.source_id IS DISTINCT FROM OLD.source_id OR
    NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.sent_to_user_id IS DISTINCT FROM OLD.sent_to_user_id OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR
    NEW.created_by<>OLD.created_by OR NEW.submission_key<>OLD.submission_key OR
    NEW.status='draft') THEN RAISE EXCEPTION 'Sent contract content is immutable'; END IF;
  IF OLD.status IN ('signed','declined','withdrawn') THEN RAISE EXCEPTION 'Completed contract records are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_contract_immutable BEFORE UPDATE OR DELETE ON employee_contracts FOR EACH ROW EXECUTE FUNCTION protect_employee_contract();
