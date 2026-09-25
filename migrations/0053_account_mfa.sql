CREATE TABLE account_mfa (
 user_id integer PRIMARY KEY REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 secret_ciphertext text, pending_ciphertext text, pending_expires_at timestamptz,
 enabled boolean NOT NULL DEFAULT false, last_step bigint NOT NULL DEFAULT -1,
 recovery_hashes jsonb NOT NULL DEFAULT '[]', failed_attempts integer NOT NULL DEFAULT 0,
 locked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
