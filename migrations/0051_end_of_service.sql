CREATE TABLE separation_policies (
  id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0), definition jsonb NOT NULL,
  created_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE employee_separations (
  id serial PRIMARY KEY, reference text NOT NULL UNIQUE, employee_id integer NOT NULL REFERENCES employees(id),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','completed','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), input jsonb NOT NULL, snapshot jsonb,
  created_by integer NOT NULL REFERENCES users(id), prepared_by integer NOT NULL REFERENCES users(id),
  reviewed_by integer REFERENCES users(id), reviewed_at timestamptz, completed_by integer REFERENCES users(id), completed_at timestamptz,
  submission_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(created_by,submission_key),
  CHECK(status NOT IN ('in_review','approved','completed') OR snapshot IS NOT NULL),
  CHECK(status NOT IN ('approved','completed') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>prepared_by)),
  CHECK(status<>'completed' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_employee_separation ON employee_separations(employee_id) WHERE status IN ('draft','in_review','approved');
CREATE INDEX employee_separation_status ON employee_separations(employee_id,status,id);
CREATE FUNCTION protect_employee_separation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Separation records must be retained'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'A separation update requires a new version'; END IF;
  IF NEW.employee_id<>OLD.employee_id OR NEW.created_by<>OLD.created_by OR NEW.reference<>OLD.reference OR NEW.submission_key<>OLD.submission_key OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Separation identity is immutable'; END IF;
  IF OLD.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'Closed separation records cannot change'; END IF;
  IF OLD.status IN ('approved') AND (NEW.input IS DISTINCT FROM OLD.input OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.prepared_by<>OLD.prepared_by) THEN RAISE EXCEPTION 'Approved settlement contents are immutable'; END IF;
  IF OLD.status='draft' AND NEW.status NOT IN ('draft','in_review','cancelled') OR OLD.status='in_review' AND NEW.status NOT IN ('draft','approved','cancelled') OR OLD.status='approved' AND NEW.status NOT IN ('completed','cancelled') THEN RAISE EXCEPTION 'Invalid separation transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_separation_immutable BEFORE UPDATE OR DELETE ON employee_separations FOR EACH ROW EXECUTE FUNCTION protect_employee_separation();
