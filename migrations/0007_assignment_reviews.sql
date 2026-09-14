CREATE TYPE "public"."assignment_review_status" AS ENUM('published', 'disputed', 'resolved', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."workforce_permission" ADD VALUE 'review_performance';--> statement-breakpoint
CREATE TABLE "assignment_review_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"version" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"status" "assignment_review_status" DEFAULT 'published' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rubric_version" integer NOT NULL,
	"rubric" jsonb NOT NULL,
	"punctuality" integer,
	"service" integer,
	"teamwork" integer,
	"role_skill" integer,
	"evidence" jsonb NOT NULL,
	"role_expectation" text NOT NULL,
	"summary" text NOT NULL,
	"improvement_actions" text NOT NULL,
	"response_kind" text,
	"employee_response" text,
	"responded_at" timestamp with time zone,
	"resolution" text,
	"resolution_reason" text,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_reviews_assignment_id_unique" UNIQUE("assignment_id"),
	CONSTRAINT "assignment_review_scores" CHECK (("assignment_reviews"."punctuality" IS NULL OR "assignment_reviews"."punctuality" BETWEEN 1 AND 5) AND ("assignment_reviews"."service" IS NULL OR "assignment_reviews"."service" BETWEEN 1 AND 5) AND ("assignment_reviews"."teamwork" IS NULL OR "assignment_reviews"."teamwork" BETWEEN 1 AND 5) AND ("assignment_reviews"."role_skill" IS NULL OR "assignment_reviews"."role_skill" BETWEEN 1 AND 5) AND coalesce("assignment_reviews"."punctuality","assignment_reviews"."service","assignment_reviews"."teamwork","assignment_reviews"."role_skill") IS NOT NULL),
	CONSTRAINT "assignment_review_versions" CHECK ("assignment_reviews"."version">0 AND "assignment_reviews"."rubric_version">0),
	CONSTRAINT "assignment_review_dispute" CHECK ("assignment_reviews"."status"<>'disputed' OR ("assignment_reviews"."response_kind"='dispute' AND "assignment_reviews"."employee_response" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "assignment_review_history" ADD CONSTRAINT "assignment_review_history_review_id_assignment_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."assignment_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_review_history" ADD CONSTRAINT "assignment_review_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_reviews" ADD CONSTRAINT "assignment_reviews_assignment_id_workforce_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."workforce_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_reviews" ADD CONSTRAINT "assignment_reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_reviews" ADD CONSTRAINT "assignment_reviews_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_review_history_version" ON "assignment_review_history" USING btree ("review_id","version");--> statement-breakpoint
CREATE INDEX "assignment_review_status_updated" ON "assignment_reviews" USING btree ("status","updated_at");