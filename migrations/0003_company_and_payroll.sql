CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll" ALTER COLUMN "basic_salary" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "payroll" ALTER COLUMN "net_salary" SET DATA TYPE numeric(14, 2);