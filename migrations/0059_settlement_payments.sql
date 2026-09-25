CREATE TABLE IF NOT EXISTS settlement_payments (
  case_id integer PRIMARY KEY REFERENCES employee_separations(id),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  status text NOT NULL CHECK(status IN ('pending','recorded','rejected')),
  reference text NOT NULL,
  paid_on date NOT NULL,
  amount_cents bigint NOT NULL CHECK(amount_cents>0),
  currency text NOT NULL,
  leave_debits jsonb NOT NULL DEFAULT '[]',
  sources jsonb NOT NULL,
  prepared_by integer NOT NULL REFERENCES users(id),
  reviewed_by integer REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by),
  CHECK(status='pending' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS settlement_payroll_allocations (
  payroll_id integer PRIMARY KEY REFERENCES payroll(id),
  case_id integer NOT NULL REFERENCES settlement_payments(case_id)
);
CREATE FUNCTION protect_settlement_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Settlement payment history must be retained'; END IF;
  IF OLD.status='recorded' THEN RAISE EXCEPTION 'Recorded settlement payments are immutable'; END IF;
  IF NEW.case_id<>OLD.case_id OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Payment identity is immutable and updates require a new version'; END IF;
  IF OLD.status='pending' THEN
    IF NEW.status NOT IN ('recorded','rejected') THEN RAISE EXCEPTION 'Pending payment requires a review decision'; END IF;
    IF (to_jsonb(NEW)-ARRAY['version','status','reviewed_by','reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','status','reviewed_by','reviewed_at']) THEN RAISE EXCEPTION 'Review cannot change proposed payment evidence'; END IF;
  ELSIF NEW.status<>'pending' THEN RAISE EXCEPTION 'Rejected payment requires a new proposal'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_payment_immutable BEFORE UPDATE OR DELETE ON settlement_payments FOR EACH ROW EXECUTE FUNCTION protect_settlement_payment();
