CREATE TYPE "public"."helpdesk_status" AS ENUM('open', 'in_progress', 'waiting_employee', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "helpdesk_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"filename" text NOT NULL,
	"object_key" text NOT NULL,
	"size" integer NOT NULL,
	CONSTRAINT "helpdesk_attachments_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "helpdesk_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"status" "helpdesk_status" DEFAULT 'open' NOT NULL,
	"requester_id" integer NOT NULL,
	"assignee_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helpdesk_version_positive" CHECK ("helpdesk_cases"."version">0)
);
--> statement-breakpoint
CREATE TABLE "helpdesk_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"details" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helpdesk_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helpdesk_attachments" ADD CONSTRAINT "helpdesk_attachments_message_id_helpdesk_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."helpdesk_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_cases" ADD CONSTRAINT "helpdesk_cases_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_cases" ADD CONSTRAINT "helpdesk_cases_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_events" ADD CONSTRAINT "helpdesk_events_case_id_helpdesk_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."helpdesk_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_events" ADD CONSTRAINT "helpdesk_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_case_id_helpdesk_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."helpdesk_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helpdesk_requester_updated" ON "helpdesk_cases" USING btree ("requester_id","updated_at");--> statement-breakpoint
CREATE INDEX "helpdesk_assignee_status" ON "helpdesk_cases" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "helpdesk_event_case" ON "helpdesk_events" USING btree ("case_id","id");--> statement-breakpoint
CREATE INDEX "helpdesk_message_case" ON "helpdesk_messages" USING btree ("case_id","id");