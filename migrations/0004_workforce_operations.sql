CREATE TYPE "public"."workforce_assignment_status" AS ENUM('offered', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workforce_kind" AS ENUM('event', 'fec', 'mall_activation');--> statement-breakpoint
CREATE TYPE "public"."workforce_permission" AS ENUM('view', 'schedule');--> statement-breakpoint
CREATE TABLE "workforce_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"status" "workforce_assignment_status" DEFAULT 'offered' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"cancellation_reason" text
);
--> statement-breakpoint
CREATE TABLE "workforce_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"permission" "workforce_permission" NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workforce_grant_dates" CHECK ("workforce_grants"."end_at" > "workforce_grants"."start_at")
);
--> statement-breakpoint
CREATE TABLE "workforce_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workforce_member_dates" CHECK ("workforce_members"."end_at" > "workforce_members"."start_at")
);
--> statement-breakpoint
CREATE TABLE "workforce_shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"role" text NOT NULL,
	"station" text,
	"headcount" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	CONSTRAINT "workforce_shift_dates" CHECK ("workforce_shifts"."end_at" > "workforce_shifts"."start_at" AND "workforce_shifts"."end_at" <= "workforce_shifts"."start_at" + interval '24 hours'),
	CONSTRAINT "workforce_shift_capacity" CHECK ("workforce_shifts"."headcount" BETWEEN 1 AND 500),
	CONSTRAINT "workforce_shift_break" CHECK ("workforce_shifts"."break_minutes" >= 0 AND "workforce_shifts"."break_minutes" < extract(epoch FROM ("workforce_shifts"."end_at" - "workforce_shifts"."start_at")) / 60)
);
--> statement-breakpoint
CREATE TABLE "workforce_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workforce_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "workforce_kind" NOT NULL,
	"site_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workforce_assignments" ADD CONSTRAINT "workforce_assignments_shift_id_workforce_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."workforce_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_assignments" ADD CONSTRAINT "workforce_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_assignments" ADD CONSTRAINT "workforce_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_grants" ADD CONSTRAINT "workforce_grants_team_id_workforce_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workforce_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_grants" ADD CONSTRAINT "workforce_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_members" ADD CONSTRAINT "workforce_members_team_id_workforce_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workforce_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_members" ADD CONSTRAINT "workforce_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_shifts" ADD CONSTRAINT "workforce_shifts_team_id_workforce_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workforce_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_shifts" ADD CONSTRAINT "workforce_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_teams" ADD CONSTRAINT "workforce_teams_site_id_workforce_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_assignment_shift_employee" ON "workforce_assignments" USING btree ("shift_id","employee_id");--> statement-breakpoint
CREATE INDEX "workforce_assignment_employee" ON "workforce_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "workforce_grant_user_team" ON "workforce_grants" USING btree ("user_id","team_id");--> statement-breakpoint
CREATE INDEX "workforce_member_team_employee" ON "workforce_members" USING btree ("team_id","employee_id");--> statement-breakpoint
CREATE INDEX "workforce_shift_team_time" ON "workforce_shifts" USING btree ("team_id","start_at");