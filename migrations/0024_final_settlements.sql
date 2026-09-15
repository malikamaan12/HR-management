CREATE TABLE final_settlements (
 id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), exit_date date NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','paid')),
 lines jsonb NOT NULL, net_amount numeric(14,2) NOT NULL CHECK(net_amount >= 0),
 created_by integer NOT NULL REFERENCES users(id), edited_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id),
 payment_reference text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(employee_id,exit_date)
);
--> statement-breakpoint
CREATE TABLE settlement_history (
 id serial PRIMARY KEY, settlement_id integer NOT NULL REFERENCES final_settlements(id), version integer NOT NULL,
 snapshot jsonb NOT NULL, actor_id integer NOT NULL REFERENCES users(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(settlement_id,version)
);
