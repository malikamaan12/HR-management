CREATE TYPE "public"."accrual_method" AS ENUM('fixed_amount', 'accrual_rate', 'none');--> statement-breakpoint
CREATE TYPE "public"."announcement_target" AS ENUM('all', 'department', 'role', 'custom');--> statement-breakpoint
CREATE TYPE "public"."application_source" AS ENUM('job_board', 'company_website', 'referral', 'internal', 'linkedin', 'social_media', 'other');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('new', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'confirmed', 'declined', 'checked_in', 'checked_out', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'on_leave');--> statement-breakpoint
CREATE TYPE "public"."blood_group" AS ENUM('a_positive', 'a_negative', 'b_positive', 'b_negative', 'ab_positive', 'ab_negative', 'o_positive', 'o_negative');--> statement-breakpoint
CREATE TYPE "public"."clock_method" AS ENUM('qr_code', 'biometric', 'mobile_app', 'manual');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('valid', 'expiring_soon', 'expired');--> statement-breakpoint
CREATE TYPE "public"."employee_category" AS ENUM('expatriate', 'national');--> statement-breakpoint
CREATE TYPE "public"."employee_type" AS ENUM('permanent', 'temporary', 'contract');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'upcoming', 'ongoing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('conference', 'concert', 'sports_event', 'exhibition', 'corporate', 'social', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('praise', 'constructive', 'peer', 'client', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('not_started', 'in_progress', 'completed', 'cancelled', 'extended');--> statement-breakpoint
CREATE TYPE "public"."half_day_option" AS ENUM('no_half_day', 'first_half', 'second_half');--> statement-breakpoint
CREATE TYPE "public"."interview_recommendation" AS ENUM('hire', 'reject', 'hold');--> statement-breakpoint
CREATE TYPE "public"."interview_round" AS ENUM('first', 'second', 'final', 'technical', 'hr');--> statement-breakpoint
CREATE TYPE "public"."leave_category" AS ENUM('paid', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('single', 'married', 'divorced', 'widowed');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('sms', 'email', 'push', 'slack');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('sent', 'delivered', 'failed', 'pending');--> statement-breakpoint
CREATE TYPE "public"."performance_rating" AS ENUM('outstanding', 'good', 'satisfactory', 'needs_improvement', 'poor');--> statement-breakpoint
CREATE TYPE "public"."religion" AS ENUM('islam', 'christianity', 'hinduism', 'buddhism', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_schedule_frequency" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'annually', 'once');--> statement-breakpoint
CREATE TYPE "public"."requisition_status" AS ENUM('draft', 'pending_approval', 'approved', 'open', 'on_hold', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_rating" AS ENUM('exceptional', 'exceeds', 'meets', 'needs_improvement', 'unsatisfactory');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'self_review', 'manager_review', 'hr_review', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_type" AS ENUM('annual', 'quarterly', 'probation', 'promotion', 'special');--> statement-breakpoint
CREATE TYPE "public"."roster_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('login_success', 'login_failure', 'logout', 'password_change', 'permission_change', 'role_assignment', 'data_access', 'api_access', 'error');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('not_started', 'in_progress', 'completed', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'c_level_executive', 'hr_director', 'hr_manager', 'recruiter', 'payroll_specialist', 'department_head', 'event_manager', 'finance_audit', 'permanent_employee', 'temporary_staff', 'employee', 'admin', 'hr', 'finance', 'manager');--> statement-breakpoint
CREATE TYPE "public"."visa_type" AS ENUM('work_visa', 'family_visa', 'business_visa', 'tourist_visa', 'other');--> statement-breakpoint
CREATE TYPE "public"."visualization_type" AS ENUM('table', 'bar_chart', 'line_chart', 'pie_chart', 'area_chart', 'scatter_plot', 'map', 'heatmap', 'kpi');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"details" text,
	"entity_type" text,
	"entity_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" integer NOT NULL,
	"target_audience" "announcement_target" NOT NULL,
	"target_department" text,
	"target_role" text,
	"expiry_date" date,
	"is_active" boolean DEFAULT true,
	"is_pinned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"date" date NOT NULL,
	"check_in" timestamp,
	"check_out" timestamp,
	"check_in_method" "clock_method",
	"check_out_method" "clock_method",
	"status" "attendance_status" NOT NULL,
	"location" text,
	"geofence_id" text,
	"break_start_time" timestamp,
	"break_end_time" timestamp,
	"total_work_hours" integer,
	"overtime_hours" integer,
	"notes" text,
	"approved_by" integer,
	"approval_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"total_rows" integer DEFAULT 0,
	"successful_rows" integer DEFAULT 0,
	"failed_rows" integer DEFAULT 0,
	"error_log" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "candidate_education" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"degree" text NOT NULL,
	"institution" text NOT NULL,
	"field_of_study" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_current_study" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_experience" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"job_title" text NOT NULL,
	"company" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_current_job" boolean DEFAULT false,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"skill_name" text NOT NULL,
	"proficiency_level" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name_en" text NOT NULL,
	"full_name_ar" text,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"linkedin_profile" text,
	"resume_url" text,
	"cover_letter_url" text,
	"qid_number" text,
	"visa_status" text,
	"source" "application_source" NOT NULL,
	"referral_employee_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"checklist_id" integer NOT NULL,
	"task_name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"assigned_to" text NOT NULL,
	"days_from_start" integer NOT NULL,
	"is_required" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_widgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"title" text NOT NULL,
	"type" "visualization_type" NOT NULL,
	"report_visualization_id" integer,
	"custom_config" jsonb,
	"refresh_interval" integer,
	"position" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"layout" jsonb,
	"is_default" boolean DEFAULT false,
	"created_by" integer NOT NULL,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"status" "document_status" NOT NULL,
	"document_file" text,
	"issue_authority" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_certifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"certificate_name" text NOT NULL,
	"issuing_authority" text NOT NULL,
	"issue_date" date NOT NULL,
	"expiry_date" date,
	"certificate_file" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"passport_number" text,
	"passport_expiry_date" date,
	"passport_scan" text,
	"visa_type" "visa_type",
	"visa_number" text,
	"visa_expiry_date" date,
	"visa_scan" text,
	"work_permit_number" text,
	"work_permit_expiry_date" date,
	"work_permit_scan" text,
	"health_card_number" text,
	"health_card_expiry_date" date,
	"health_card_scan" text,
	"medical_certificate_date" date,
	"medical_certificate_scan" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_education" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"degree" text NOT NULL,
	"institution" text NOT NULL,
	"year" integer NOT NULL,
	"grade" text,
	"certificate_file" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"feedback_type" "feedback_type" NOT NULL,
	"content" text NOT NULL,
	"anonymous" boolean DEFAULT false,
	"visibility" text NOT NULL,
	"related_goal_id" integer,
	"related_review_id" integer,
	"acknowledged" boolean DEFAULT false,
	"acknowledgement_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"start_date" date NOT NULL,
	"due_date" date NOT NULL,
	"completion_date" date,
	"status" "goal_status" DEFAULT 'not_started' NOT NULL,
	"priority" "goal_priority" DEFAULT 'medium' NOT NULL,
	"progress" integer DEFAULT 0,
	"aligned_to_business_objective" text,
	"manager_feedback" text,
	"is_visible" boolean DEFAULT true,
	"related_review_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_languages" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"language" text NOT NULL,
	"proficiency_level" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_onboarding" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"offer_id" integer,
	"checklist_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text NOT NULL,
	"progress" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"proficiency_level" integer NOT NULL,
	"certified" boolean DEFAULT false,
	"certification_date" timestamp,
	"certification_expiry" timestamp,
	"notes" text,
	"last_assessed" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_skills_legacy" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"skill_name" text NOT NULL,
	"proficiency_level" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_training" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"enrollment_date" timestamp DEFAULT now() NOT NULL,
	"completion_date" timestamp,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"progress" integer DEFAULT 0,
	"score" integer,
	"certificate_url" text,
	"feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"employee_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"full_name_arabic" text,
	"gender" "gender" NOT NULL,
	"date_of_birth" date NOT NULL,
	"nationality" text NOT NULL,
	"qid_number" text NOT NULL,
	"marital_status" "marital_status",
	"religion" "religion",
	"blood_group" "blood_group",
	"primary_mobile" text NOT NULL,
	"secondary_contact" text,
	"personal_email" text,
	"photo" text,
	"residential_address" text NOT NULL,
	"home_country_address" text,
	"emergency_contact_name" text NOT NULL,
	"emergency_contact_number" text NOT NULL,
	"emergency_contact_relation" text,
	"type" "employee_type" NOT NULL,
	"event_staff_eligible" boolean DEFAULT false,
	"department" text NOT NULL,
	"position" text NOT NULL,
	"location" text NOT NULL,
	"reporting_manager_id" integer,
	"secondary_manager_id" integer,
	"joining_date" date NOT NULL,
	"contract_end_date" date,
	"work_location" text,
	"work_email" text,
	"work_phone" text,
	"cost_center" text,
	"employee_category" "employee_category",
	"job_grade" text,
	"probation_period" integer,
	"notice_period" integer,
	"bank_name" text,
	"iban_number" text,
	"swift_code" text,
	"bank_branch" text,
	"account_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employees_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "employees_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "employees_qid_number_unique" UNIQUE("qid_number")
);
--> statement-breakpoint
CREATE TABLE "event_communication_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"communication_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_communications" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"message_type" text NOT NULL,
	"subject" text NOT NULL,
	"content" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"role_name" text NOT NULL,
	"role_description" text,
	"number_of_staff" integer DEFAULT 1 NOT NULL,
	"hourly_rate" numeric NOT NULL,
	"required_skills" text[],
	"qualifications" text[],
	"uniform_requirements" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_rosters" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"roster_name" text NOT NULL,
	"status" "roster_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"published_by" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_staff_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"role" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_staff_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"rated_by" integer NOT NULL,
	"rating" "performance_rating" NOT NULL,
	"punctuality_rating" integer NOT NULL,
	"attitude_rating" integer NOT NULL,
	"skill_rating" integer NOT NULL,
	"comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_staff_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"preferred_roles" text[],
	"availability" json NOT NULL,
	"average_rating" numeric,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"location" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" serial PRIMARY KEY NOT NULL,
	"geofence_id" text NOT NULL,
	"geofence_name" text NOT NULL,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"radius" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"associated_locations" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "geofences_geofence_id_unique" UNIQUE("geofence_id")
);
--> statement-breakpoint
CREATE TABLE "goal_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" date,
	"completion_date" date,
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"milestone_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"interviewer_id" integer NOT NULL,
	"interview_date" timestamp NOT NULL,
	"interview_type" text NOT NULL,
	"interview_round" "interview_round" NOT NULL,
	"rating" integer,
	"feedback" text,
	"recommendation" "interview_recommendation",
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"requisition_id" integer NOT NULL,
	"application_date" date NOT NULL,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"screening_score" integer,
	"screening_notes" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"offer_date" date NOT NULL,
	"start_date" date,
	"salary" integer NOT NULL,
	"benefits" json,
	"expiry_date" date NOT NULL,
	"status" text NOT NULL,
	"acceptance_date" date,
	"decline_reason" text,
	"offer_letter" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"requisition_id" integer NOT NULL,
	"channel" text NOT NULL,
	"channel_url" text,
	"post_date" date NOT NULL,
	"expiry_date" date,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_requisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"requisition_id" text NOT NULL,
	"job_title" text NOT NULL,
	"department" text NOT NULL,
	"location" text NOT NULL,
	"position_type" text NOT NULL,
	"salary_range" text,
	"number_of_vacancies" integer NOT NULL,
	"job_description" text NOT NULL,
	"qualifications" text NOT NULL,
	"responsibilities" text NOT NULL,
	"required_skills" text NOT NULL,
	"preferred_skills" text,
	"posting_start_date" date,
	"posting_end_date" date,
	"is_internal" boolean DEFAULT false,
	"status" "requisition_status" DEFAULT 'draft' NOT NULL,
	"requested_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_requisitions_requisition_id_unique" UNIQUE("requisition_id")
);
--> statement-breakpoint
CREATE TABLE "leave_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_id" integer NOT NULL,
	"approver_id" integer NOT NULL,
	"approval_order" integer NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"comments" text,
	"action_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"year" integer NOT NULL,
	"opening_balance" numeric DEFAULT '0' NOT NULL,
	"accrued" numeric DEFAULT '0' NOT NULL,
	"used" numeric DEFAULT '0' NOT NULL,
	"pending" numeric DEFAULT '0' NOT NULL,
	"adjusted" numeric DEFAULT '0' NOT NULL,
	"last_accrual_date" date,
	"expiry_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_supporting_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_file" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "leave_category" NOT NULL,
	"accrual_method" "accrual_method" NOT NULL,
	"accrual_rate" numeric,
	"max_accrual" numeric,
	"carryover_allowed" boolean DEFAULT false,
	"carryover_limit" numeric,
	"requires_medical_certificate" boolean DEFAULT false,
	"min_service_days" integer DEFAULT 0,
	"max_consecutive_days" integer,
	"applicable_genders" text[],
	"description" text,
	"active" boolean DEFAULT true,
	"qatar_labor_law_mandated" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"total_days" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"email_enabled" boolean DEFAULT true,
	"sms_enabled" boolean DEFAULT true,
	"push_enabled" boolean DEFAULT true,
	"slack_enabled" boolean DEFAULT true,
	"announcements" boolean DEFAULT true,
	"leave_updates" boolean DEFAULT true,
	"document_expiry" boolean DEFAULT true,
	"event_assignments" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"message" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"data" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"department_specific" text,
	"employee_type_specific" "employee_type",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"onboarding_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"assigned_to" text NOT NULL,
	"assignee_id" integer,
	"due_date" date NOT NULL,
	"completed_date" date,
	"status" "task_status" DEFAULT 'not_started' NOT NULL,
	"comments" text,
	"document_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"basic_salary" integer NOT NULL,
	"allowances" json NOT NULL,
	"deductions" json NOT NULL,
	"net_salary" integer NOT NULL,
	"wps_reference" text,
	"status" text NOT NULL,
	"processed_by" integer,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"review_type" "review_type" NOT NULL,
	"review_period_start" date NOT NULL,
	"review_period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"completed_date" date,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"overall_rating" "review_rating",
	"summary" text,
	"strengths" text,
	"areas_for_improvement" text,
	"hr_comments" text,
	"private_notes" text,
	"is_template" boolean DEFAULT false,
	"template_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "report_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" integer NOT NULL,
	"is_public" boolean DEFAULT false,
	"last_run" timestamp,
	"query_definition" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_execution_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"executed_by" integer,
	"executed_at" timestamp DEFAULT now() NOT NULL,
	"parameters" jsonb,
	"result_count" integer,
	"execution_time" integer,
	"status" text NOT NULL,
	"error_message" text,
	"export_format" text,
	"export_path" text
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"name" text NOT NULL,
	"frequency" "report_schedule_frequency" NOT NULL,
	"next_run_date" timestamp NOT NULL,
	"recipients" text[],
	"export_format" text DEFAULT 'pdf',
	"active" boolean DEFAULT true,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_visualizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "visualization_type" NOT NULL,
	"config" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_criteria" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"criteria_name" text NOT NULL,
	"criteria_description" text,
	"criteria_weight" integer,
	"criteria_order" integer NOT NULL,
	"self_rating" "review_rating",
	"manager_rating" "review_rating",
	"self_comments" text,
	"manager_comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"section_name" text NOT NULL,
	"section_description" text,
	"section_weight" integer,
	"section_order" integer NOT NULL,
	"section_rating" "review_rating",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"required_proficiency_level" integer NOT NULL,
	"importance" text DEFAULT 'important' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "security_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" "security_event_type" NOT NULL,
	"user_id" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb,
	"severity" text DEFAULT 'info',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift_name" text NOT NULL,
	"date" date NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"break_duration" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"location" text NOT NULL,
	"assigned_role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"assessment_date" date NOT NULL,
	"assessor_id" integer,
	"self_assessment_rating" integer,
	"manager_assessment_rating" integer,
	"comments" text,
	"development_plan" text,
	"related_review_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_integration" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_email" text NOT NULL,
	"slack_username" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"last_synced" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_course_id" text,
	"title" text NOT NULL,
	"description" text,
	"provider" text,
	"skill_ids" text[],
	"duration" integer,
	"format" text,
	"level" text,
	"url" text,
	"cost" numeric,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"assigned_by" integer,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" "user_role" DEFAULT 'employee' NOT NULL,
	"department" text,
	"qid_number" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"last_login" timestamp,
	"refresh_token" text,
	"password_reset_token" text,
	"password_reset_expires" timestamp,
	"failed_login_attempts" integer DEFAULT 0,
	"lockout_until" timestamp,
	"avatar" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_qid_number_unique" UNIQUE("qid_number")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_approved_by_employees_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_import_jobs" ADD CONSTRAINT "bulk_import_jobs_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_experience" ADD CONSTRAINT "candidate_experience_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_referral_employee_id_employees_id_fk" FOREIGN KEY ("referral_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_checklist_id_onboarding_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."onboarding_checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_report_visualization_id_report_visualizations_id_fk" FOREIGN KEY ("report_visualization_id") REFERENCES "public"."report_visualizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_education" ADD CONSTRAINT "employee_education_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_feedback" ADD CONSTRAINT "employee_feedback_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_feedback" ADD CONSTRAINT "employee_feedback_provider_id_employees_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_feedback" ADD CONSTRAINT "employee_feedback_related_goal_id_employee_goals_id_fk" FOREIGN KEY ("related_goal_id") REFERENCES "public"."employee_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_feedback" ADD CONSTRAINT "employee_feedback_related_review_id_performance_reviews_id_fk" FOREIGN KEY ("related_review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_related_review_id_performance_reviews_id_fk" FOREIGN KEY ("related_review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_languages" ADD CONSTRAINT "employee_languages_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_onboarding" ADD CONSTRAINT "employee_onboarding_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_onboarding" ADD CONSTRAINT "employee_onboarding_offer_id_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_onboarding" ADD CONSTRAINT "employee_onboarding_checklist_id_onboarding_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."onboarding_checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills_legacy" ADD CONSTRAINT "employee_skills_legacy_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_training" ADD CONSTRAINT "employee_training_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_training" ADD CONSTRAINT "employee_training_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_reporting_manager_id_employees_id_fk" FOREIGN KEY ("reporting_manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_secondary_manager_id_employees_id_fk" FOREIGN KEY ("secondary_manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_communication_recipients" ADD CONSTRAINT "event_communication_recipients_communication_id_event_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."event_communications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_communication_recipients" ADD CONSTRAINT "event_communication_recipients_recipient_id_employees_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_communications" ADD CONSTRAINT "event_communications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_communications" ADD CONSTRAINT "event_communications_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_roles" ADD CONSTRAINT "event_roles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rosters" ADD CONSTRAINT "event_rosters_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rosters" ADD CONSTRAINT "event_rosters_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff_assignments" ADD CONSTRAINT "event_staff_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff_assignments" ADD CONSTRAINT "event_staff_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff_performance" ADD CONSTRAINT "event_staff_performance_assignment_id_event_staff_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."event_staff_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff_performance" ADD CONSTRAINT "event_staff_performance_rated_by_employees_id_fk" FOREIGN KEY ("rated_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff_profiles" ADD CONSTRAINT "event_staff_profiles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_employee_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."employee_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewer_id_employees_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_requisition_id_job_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."job_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_requisition_id_job_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."job_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_requested_by_employees_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_approved_by_employees_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approvals" ADD CONSTRAINT "leave_approvals_leave_id_leaves_id_fk" FOREIGN KEY ("leave_id") REFERENCES "public"."leaves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approvals" ADD CONSTRAINT "leave_approvals_approver_id_employees_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_supporting_documents" ADD CONSTRAINT "leave_supporting_documents_leave_id_leaves_id_fk" FOREIGN KEY ("leave_id") REFERENCES "public"."leaves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_supporting_documents" ADD CONSTRAINT "leave_supporting_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_onboarding_id_employee_onboarding_id_fk" FOREIGN KEY ("onboarding_id") REFERENCES "public"."employee_onboarding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_task_id_checklist_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."checklist_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll" ADD CONSTRAINT "payroll_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll" ADD CONSTRAINT "payroll_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_id_employees_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_execution_history" ADD CONSTRAINT "report_execution_history_report_id_report_definitions_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_execution_history" ADD CONSTRAINT "report_execution_history_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_report_id_report_definitions_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_visualizations" ADD CONSTRAINT "report_visualizations_report_id_report_definitions_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_criteria" ADD CONSTRAINT "review_criteria_section_id_review_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."review_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sections" ADD CONSTRAINT "review_sections_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_skills" ADD CONSTRAINT "role_skills_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_skills" ADD CONSTRAINT "role_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_logs" ADD CONSTRAINT "security_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_schedules" ADD CONSTRAINT "shift_schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_skill_id_employee_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."employee_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_assessor_id_employees_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_related_review_id_performance_reviews_id_fk" FOREIGN KEY ("related_review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_integration" ADD CONSTRAINT "slack_integration_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;