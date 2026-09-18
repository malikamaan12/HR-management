CREATE TABLE learning_induction_releases (
 id serial PRIMARY KEY,course_id integer NOT NULL REFERENCES learning_courses(id),release_number integer NOT NULL CHECK(release_number>0),
 course_version integer NOT NULL,definition jsonb NOT NULL,content jsonb NOT NULL,created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(course_id,release_number)
);
--> statement-breakpoint
CREATE TABLE learning_induction_courses (course_id integer PRIMARY KEY REFERENCES learning_courses(id),published_release_id integer REFERENCES learning_induction_releases(id));
--> statement-breakpoint
CREATE TABLE learning_induction_drafts (course_id integer PRIMARY KEY REFERENCES learning_induction_courses(course_id),version integer NOT NULL DEFAULT 1 CHECK(version>0),definition jsonb NOT NULL,content jsonb NOT NULL,updated_by integer NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE learning_induction_assets (
 id serial PRIMARY KEY,course_id integer REFERENCES learning_induction_courses(course_id),kind text NOT NULL CHECK(kind IN ('lesson','logo')),
 object_key text NOT NULL UNIQUE,filename text NOT NULL,mime text NOT NULL,size integer NOT NULL CHECK(size BETWEEN 1 AND 41943040),created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK((kind='lesson' AND course_id IS NOT NULL) OR(kind='logo' AND course_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE learning_induction_branding (id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL DEFAULT 1 CHECK(version>0),config jsonb NOT NULL,updated_by integer NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE learning_induction_enrollments (
 enrollment_id integer PRIMARY KEY REFERENCES learning_enrollments(id),release_id integer NOT NULL REFERENCES learning_induction_releases(id),required boolean NOT NULL DEFAULT false,passed_attempt_id integer,completion_brand jsonb
);
--> statement-breakpoint
CREATE TABLE learning_induction_lesson_progress (
 enrollment_id integer NOT NULL REFERENCES learning_induction_enrollments(enrollment_id),lesson_id uuid NOT NULL,opened_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,completed_by integer REFERENCES users(id),PRIMARY KEY(enrollment_id,lesson_id)
);
--> statement-breakpoint
CREATE TABLE learning_induction_attempts (
 id serial PRIMARY KEY,enrollment_id integer NOT NULL REFERENCES learning_induction_enrollments(enrollment_id),attempt_number integer NOT NULL CHECK(attempt_number>0),start_key uuid NOT NULL,
 questions jsonb NOT NULL,answers jsonb,status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','submitted','expired')),
 started_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,submitted_at timestamptz,created_by integer NOT NULL REFERENCES users(id),
 score integer CHECK(score BETWEEN 0 AND 100),earned_points integer,total_points integer,passed boolean,UNIQUE(enrollment_id,attempt_number),UNIQUE(enrollment_id,start_key)
);
--> statement-breakpoint
CREATE UNIQUE INDEX learning_one_open_quiz ON learning_induction_attempts(enrollment_id) WHERE status='in_progress';
--> statement-breakpoint
ALTER TABLE learning_induction_enrollments ADD CONSTRAINT learning_induction_passed_attempt FOREIGN KEY(passed_attempt_id) REFERENCES learning_induction_attempts(id);
--> statement-breakpoint
CREATE INDEX learning_induction_attempt_history ON learning_induction_attempts(enrollment_id,id);
--> statement-breakpoint
CREATE FUNCTION keep_learning_induction_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published course releases are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER learning_induction_release_immutable BEFORE UPDATE OR DELETE ON learning_induction_releases FOR EACH ROW EXECUTE FUNCTION keep_learning_induction_release();
