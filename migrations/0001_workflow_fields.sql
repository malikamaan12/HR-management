ALTER TABLE "employees" ADD COLUMN "termination_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "role_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "event_type" "event_type" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "shift_schedules" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;