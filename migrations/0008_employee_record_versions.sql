ALTER TABLE employees ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK (record_version > 0);
--> statement-breakpoint
CREATE FUNCTION increment_employee_record_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.record_version := OLD.record_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER employee_record_version BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION increment_employee_record_version();
