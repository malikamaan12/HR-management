ALTER TABLE users ADD COLUMN account_state text NOT NULL DEFAULT 'active',
  ADD COLUMN account_version integer NOT NULL DEFAULT 1,
  ADD COLUMN password_setup_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE users SET account_state = 'on_hold' WHERE is_active = false AND approval_status = 'approved';
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_account_state_check CHECK (account_state IN ('active','frozen','on_hold','revoked','deleted'));
