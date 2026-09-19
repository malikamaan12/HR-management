ALTER TYPE workforce_kind ADD VALUE IF NOT EXISTS 'head_office';
CREATE TABLE workforce_org_chart_revisions (
 id serial PRIMARY KEY,
 team_id integer NOT NULL REFERENCES workforce_teams(id),
 version integer NOT NULL CHECK (version > 0),
 effective_from date NOT NULL,
 effective_to date,
 nodes jsonb NOT NULL CHECK (jsonb_typeof(nodes)='array'),
 reason text NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(team_id,version),
 CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX workforce_org_chart_dates ON workforce_org_chart_revisions(team_id,effective_from,effective_to);
