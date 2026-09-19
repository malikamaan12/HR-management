# Configurable HR Helpdesk

The Helpdesk now separates Requests, Knowledge base and Administration. Requests show permission-scoped totals, active/overdue/completed counts, a status distribution, searchable request rows, assignment filters, response deadlines, and category cards. Counts cover the selected personal or HR view independently of table filters. Only existing records contribute to the overview; no example cases, articles, contacts or metrics are inserted.

## Content administration

Authorized helpdesk administrators can edit the page title, introduction, request guidance, support instructions, upload limit, and service categories. Categories have stable keys, editable names/descriptions, ordering, enabled state and confidential handling. Disabled categories remain available for historical filtering and rule management. Existing keys cannot be removed or renamed. Confidential categories cannot be downgraded; a separate category can be created instead. Existing cases retain their own visibility and saved routing/response targets.

New requests and articles validate categories against the saved configuration on the server. Existing articles can still be revised or archived with an inactive category. Upload limits are enforced on both client and server within the existing 10 MB security ceiling. Accepted attachment formats remain PDF, PNG and JPEG with existing file validation and private downloads.

Settings saves use an expected version, row locking and revision history. The editor preserves its starting version so concurrent changes cause a conflict rather than overwriting another administrator's configuration. Reload saved settings explicitly loads the current version.

New routing rules no longer assume a category or 24/72-hour response targets. New calendar windows no longer assume opening/closing times. Articles, rules, targets, calendars and case conversations continue to use their existing database-backed workflows. Fixed interface labels and access-control rules remain application code; business content is saved configuration.

## Release status

- Migration `0048_helpdesk_workspace` adds one versioned `app_settings` record, preserving the eight existing category keys and labels as editable initial configuration. It does not create cases or employee records.
- Apply this migration before serving the updated application. Missing or invalid configuration produces an unavailable response, rather than substituting hardcoded business content.
- Production frontend build completed successfully, with the existing large main-chunk warning.
- Production server bundle completed successfully.
- No tests, type-check suite, browser audit, or runtime database verification was performed, following the user's instruction to skip tests and audits.
- No deployment or production database changes were performed in this turn.
