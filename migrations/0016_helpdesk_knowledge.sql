CREATE TABLE helpdesk_articles (
 id serial PRIMARY KEY, title text NOT NULL, body text NOT NULL, category text NOT NULL,
 published boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 updated_by integer NOT NULL REFERENCES users(id), updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE helpdesk_article_versions (
 id serial PRIMARY KEY, article_id integer NOT NULL REFERENCES helpdesk_articles(id), version integer NOT NULL,
 snapshot jsonb NOT NULL, created_by integer NOT NULL REFERENCES users(id), created_at timestamp NOT NULL DEFAULT now(),
 UNIQUE(article_id,version)
);
