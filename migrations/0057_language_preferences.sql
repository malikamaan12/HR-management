CREATE TABLE account_preferences (
 user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 language text NOT NULL DEFAULT 'en' CHECK(language IN ('en','ar')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
