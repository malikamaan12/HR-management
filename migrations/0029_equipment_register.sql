CREATE TABLE hr_equipment_assets (
 id serial PRIMARY KEY, asset_tag varchar(100) NOT NULL UNIQUE,
 name varchar(200) NOT NULL, category varchar(100) NOT NULL,
 serial_number varchar(150) NOT NULL DEFAULT '', location varchar(200) NOT NULL DEFAULT '',
 purchase_date date, warranty_until date,
 condition text NOT NULL DEFAULT 'good' CHECK(condition IN ('new','good','fair','damaged','lost')),
 state text NOT NULL DEFAULT 'available' CHECK(state IN ('available','issued','maintenance','retired','lost')),
 notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(warranty_until IS NULL OR purchase_date IS NULL OR warranty_until>=purchase_date)
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_equipment_asset_tag_unique ON hr_equipment_assets(upper(asset_tag));
--> statement-breakpoint
CREATE TABLE hr_equipment_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0), definition jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE hr_equipment_assignments (
 id serial PRIMARY KEY, asset_id integer NOT NULL REFERENCES hr_equipment_assets(id), employee_id integer NOT NULL REFERENCES employees(id),
 issued_on date NOT NULL, due_on date, issued_condition text NOT NULL CHECK(issued_condition IN ('new','good','fair','damaged')),
 issue_note text NOT NULL, issued_by integer NOT NULL REFERENCES users(id), asset_snapshot jsonb NOT NULL, policy_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','return_requested','returned','written_off')),
 acknowledgement text NOT NULL DEFAULT 'pending' CHECK(acknowledgement IN ('pending','accepted','disputed','not_required')),
 acknowledgement_due_on date, acknowledged_by integer REFERENCES users(id), acknowledged_at timestamptz, acknowledgement_note text,
 requested_condition text CHECK(requested_condition IN ('new','good','fair','damaged','lost')), return_request_note text,
 return_requested_by integer REFERENCES users(id), return_requested_at timestamptz,
 returned_on date, returned_condition text CHECK(returned_condition IN ('new','good','fair','damaged','lost')), return_note text, return_evidence text,
 closed_by integer REFERENCES users(id), closed_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(due_on IS NULL OR due_on>=issued_on), CHECK(returned_on IS NULL OR returned_on>=issued_on),
 CHECK(status NOT IN ('returned','written_off') OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND returned_on IS NOT NULL)),
 CHECK(status<>'return_requested' OR (return_requested_by IS NOT NULL AND return_requested_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_equipment_one_active_holder ON hr_equipment_assignments(asset_id) WHERE status IN ('issued','return_requested');
--> statement-breakpoint
CREATE INDEX hr_equipment_employee_custody ON hr_equipment_assignments(employee_id,status,due_on);
--> statement-breakpoint
CREATE INDEX hr_equipment_asset_state ON hr_equipment_assets(state,category,id);
