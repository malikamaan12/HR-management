CREATE TABLE attendance_geofence_policy (
 id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL DEFAULT 1 CHECK(version>0), config jsonb NOT NULL,
 enforced_from timestamptz NOT NULL DEFAULT now(), updated_by integer REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO attendance_geofence_policy(id,config) VALUES (1,'{"required":false,"maxAccuracyMeters":100,"maxAgeSeconds":90,"requirePermanentApproval":false}');
--> statement-breakpoint
CREATE TABLE attendance_geofence_locations (
 id serial PRIMARY KEY,version integer NOT NULL DEFAULT 1 CHECK(version>0),config jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE attendance_geofence_history (
 id serial PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('policy','location')),record_id integer NOT NULL,version integer NOT NULL,
 snapshot jsonb NOT NULL,reason text NOT NULL,actor_id integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE attendance ADD COLUMN location_in jsonb,ADD COLUMN location_out jsonb,
 ADD COLUMN approval_status text NOT NULL DEFAULT 'not_required' CHECK(approval_status IN ('not_required','pending','approved','rejected')),
 ADD COLUMN supervisor_user_id integer REFERENCES users(id),ADD COLUMN supervisor_note text,ADD COLUMN supervisor_reviewed_at timestamptz;
--> statement-breakpoint
ALTER TABLE workforce_presence ADD COLUMN location_in jsonb,ADD COLUMN location_out jsonb,
 ADD COLUMN approval_status text NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected'));
--> statement-breakpoint
UPDATE workforce_presence SET approval_status='approved' WHERE reviewed_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX attendance_approval_queue ON attendance(approval_status,date);
