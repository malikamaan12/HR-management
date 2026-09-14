CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'returned', 'approved', 'payroll_locked');--> statement-breakpoint
ALTER TYPE "public"."workforce_permission" ADD VALUE 'review_time';--> statement-breakpoint
CREATE TABLE "timesheet_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"timesheet_id" integer NOT NULL,
	"version" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workforce_timesheets" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"actual_start_at" timestamp with time zone NOT NULL,
	"actual_end_at" timestamp with time zone NOT NULL,
	"break_minutes" integer NOT NULL,
	"worked_minutes" integer NOT NULL,
	"employee_note" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewer_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"payable_minutes" integer,
	"policy_reference" text,
	"payroll_id" integer,
	"locked_by" integer,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workforce_timesheets_assignment_id_unique" UNIQUE("assignment_id"),
	CONSTRAINT "timesheet_actual_dates" CHECK ("workforce_timesheets"."actual_end_at">"workforce_timesheets"."actual_start_at" AND "workforce_timesheets"."actual_end_at"<="workforce_timesheets"."actual_start_at"+interval '24 hours'),
	CONSTRAINT "timesheet_minutes" CHECK ("workforce_timesheets"."version">0 AND "workforce_timesheets"."break_minutes">=0 AND "workforce_timesheets"."worked_minutes">0 AND "workforce_timesheets"."worked_minutes"+"workforce_timesheets"."break_minutes"=extract(epoch FROM ("workforce_timesheets"."actual_end_at"-"workforce_timesheets"."actual_start_at"))/60),
	CONSTRAINT "timesheet_payable_minutes" CHECK ("workforce_timesheets"."payable_minutes" IS NULL OR ("workforce_timesheets"."payable_minutes">=0 AND "workforce_timesheets"."payable_minutes"<="workforce_timesheets"."worked_minutes"+"workforce_timesheets"."break_minutes")),
	CONSTRAINT "timesheet_approval_fields" CHECK ("workforce_timesheets"."status" NOT IN ('approved','payroll_locked') OR ("workforce_timesheets"."reviewer_id" IS NOT NULL AND "workforce_timesheets"."reviewed_at" IS NOT NULL AND "workforce_timesheets"."payable_minutes" IS NOT NULL AND "workforce_timesheets"."policy_reference" IS NOT NULL)),
	CONSTRAINT "timesheet_lock_fields" CHECK (("workforce_timesheets"."status"='payroll_locked') = ("workforce_timesheets"."payroll_id" IS NOT NULL AND "workforce_timesheets"."locked_by" IS NOT NULL AND "workforce_timesheets"."locked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "timesheet_revisions" ADD CONSTRAINT "timesheet_revisions_timesheet_id_workforce_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."workforce_timesheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_revisions" ADD CONSTRAINT "timesheet_revisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_timesheets" ADD CONSTRAINT "workforce_timesheets_assignment_id_workforce_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."workforce_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_timesheets" ADD CONSTRAINT "workforce_timesheets_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_timesheets" ADD CONSTRAINT "workforce_timesheets_payroll_id_payroll_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."payroll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_timesheets" ADD CONSTRAINT "workforce_timesheets_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_revision_version" ON "timesheet_revisions" USING btree ("timesheet_id","version");--> statement-breakpoint
CREATE INDEX "timesheet_status_updated" ON "workforce_timesheets" USING btree ("status","updated_at");