CREATE TABLE learning_induction_starter_courses (
 starter_key text PRIMARY KEY,
 course_id integer NOT NULL UNIQUE REFERENCES learning_induction_courses(course_id),
 library_version integer NOT NULL CHECK(library_version>0),
 installed_by integer NOT NULL REFERENCES users(id),
 installed_at timestamptz NOT NULL DEFAULT now()
);
