-- Existing category keys are retained so historical cases, rules and articles keep their meaning.
-- This is editable initial configuration, never a runtime fallback.
INSERT INTO app_settings (key, value) VALUES ('helpdesk_workspace', '{
  "version": 1,
  "workspace": {
    "title": "HR Helpdesk",
    "introduction": "Ask HR, track your requests and keep the conversation in one place.",
    "requestGuidance": "Describe the support you need and include any relevant dates or documents.",
    "contactInstructions": "",
    "attachmentMegabytes": 10,
    "categories": [
      {"id":"payroll","label":"Payroll query","description":"","enabled":true,"confidential":false},
      {"id":"attendance","label":"Attendance correction","description":"","enabled":true,"confidential":false},
      {"id":"documents","label":"Document or letter request","description":"","enabled":true,"confidential":false},
      {"id":"shifts","label":"Shift support","description":"","enabled":true,"confidential":false},
      {"id":"transport_accommodation","label":"Transport or accommodation","description":"","enabled":true,"confidential":false},
      {"id":"equipment","label":"Equipment or uniform","description":"","enabled":true,"confidential":false},
      {"id":"employee_relations","label":"Employee relations","description":"","enabled":true,"confidential":true},
      {"id":"other","label":"Other HR request","description":"","enabled":true,"confidential":false}
    ]
  }
}'::jsonb) ON CONFLICT (key) DO NOTHING;
