CREATE TABLE IF NOT EXISTS privacy_access_exports (
  request_id integer PRIMARY KEY REFERENCES privacy_requests(id),
  prepared_by integer NOT NULL REFERENCES users(id),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  content text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256)=64)
);
CREATE TABLE IF NOT EXISTS privacy_corrections (
  request_id integer PRIMARY KEY REFERENCES privacy_requests(id),
  prepared_by integer NOT NULL REFERENCES users(id),
  employee_version integer NOT NULL,
  proposed jsonb NOT NULL,
  applied_at timestamptz
);
