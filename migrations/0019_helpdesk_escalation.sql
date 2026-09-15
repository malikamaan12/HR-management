ALTER TABLE helpdesk_cases ADD COLUMN escalated_at timestamptz;
--> statement-breakpoint
CREATE INDEX helpdesk_escalated_active ON helpdesk_cases (escalated_at) WHERE escalated_at IS NOT NULL;
