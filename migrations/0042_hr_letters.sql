CREATE TABLE hr_letter_templates (
  id serial PRIMARY KEY,
  code text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  definition jsonb NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  published_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE(code,revision)
);
CREATE UNIQUE INDEX hr_letter_one_draft ON hr_letter_templates(code) WHERE status='draft';
CREATE FUNCTION protect_hr_letter_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.code <> OLD.code OR NEW.revision <> OLD.revision OR NEW.status = 'draft') THEN
    RAISE EXCEPTION 'Published letter templates are immutable; create a new revision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_letter_template_immutable BEFORE UPDATE ON hr_letter_templates FOR EACH ROW EXECUTE FUNCTION protect_hr_letter_template();
CREATE TABLE hr_letter_requests (
  id serial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  employee_id integer NOT NULL REFERENCES employees(id),
  template_id integer NOT NULL REFERENCES hr_letter_templates(id),
  recipient text NOT NULL,
  purpose text NOT NULL,
  submission_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','prepared','returned','issued','rejected','cancelled','revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  snapshot jsonb,
  created_by integer NOT NULL REFERENCES users(id),
  prepared_by integer REFERENCES users(id),
  prepared_at timestamptz,
  issued_by integer REFERENCES users(id),
  issued_by_name text,
  issued_at timestamptz,
  revoked_by integer REFERENCES users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(created_by,submission_key),
  CHECK (status NOT IN ('prepared','issued','revoked') OR (snapshot IS NOT NULL AND prepared_by IS NOT NULL)),
  CHECK (status NOT IN ('issued','revoked') OR (issued_by IS NOT NULL AND issued_at IS NOT NULL AND issued_by <> prepared_by AND issued_by <> created_by))
);
CREATE INDEX hr_letters_employee_status ON hr_letter_requests(employee_id,status,id);
CREATE INDEX hr_letters_status ON hr_letter_requests(status,id);
CREATE FUNCTION protect_hr_issued_letter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('issued','revoked') AND (
    NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.employee_id <> OLD.employee_id OR NEW.template_id <> OLD.template_id OR
    NEW.reference <> OLD.reference OR NEW.recipient <> OLD.recipient OR NEW.purpose <> OLD.purpose OR
    NEW.created_by <> OLD.created_by OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at OR NEW.submission_key <> OLD.submission_key OR
    NEW.issued_by IS DISTINCT FROM OLD.issued_by OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.issued_by_name IS DISTINCT FROM OLD.issued_by_name OR
    NEW.status NOT IN ('issued','revoked') OR (OLD.status='revoked' AND NEW.status<>'revoked')) THEN
    RAISE EXCEPTION 'Issued letter content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_issued_letter_immutable BEFORE UPDATE ON hr_letter_requests FOR EACH ROW EXECUTE FUNCTION protect_hr_issued_letter();
