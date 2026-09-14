ALTER TABLE employees ADD COLUMN work_schedule text NOT NULL DEFAULT 'unassigned'
CHECK (work_schedule IN ('unassigned', 'management_office', 'shift_based'));
