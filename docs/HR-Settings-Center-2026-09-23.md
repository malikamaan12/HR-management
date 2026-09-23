# HR Rules & Settings center

The administrator settings workspace at `/settings` collects 27 areas into six categories. Search covers policy names and related terms; category cards and a grouped jump selector open the existing editors inside the center. Mobile layouts use stacked cards and wrapping controls. Animations respect reduced-motion preferences.

## Areas

- Company: company contact details and office calendar; branding; teams, sites, lead access and arrival rules.
- Time & pay: attendance rules; leave and approvers; salary and payroll rules; calculation methods; GPS and attendance approval controls.
- People: employment continuity; onboarding approvals; checklist templates; mandatory training; performance review cycles.
- Employee services: benefits; expenses; equipment; helpdesk content, routing and automation; communication policy.
- Records: document reviews; handbook acknowledgement rules; HR letter templates; retention rules; reporting rules.
- System: accounts and roles; reminders; operational setup overview; service and recovery status.

## Compatibility and permissions

The sidebar and module launcher show one HR Rules & Settings entry. Old `/hr-rules`, `/reminder-rules`, `/user-management` and `/operations-setup` URLs redirect to the relevant section; operational setup preserves its supported `tab` destinations. Attendance, leave and payroll shortcuts point to their own settings editor.

Access remains Admin / Super Admin, with existing API permissions, version checks, employee overrides and change-history workflows. Scoped module workflows remain available through their original modules. The settings panels reuse those forms and endpoints; no schema migration, data import or live policy change is included. Personal password changes remain in My account.

Company settings now wait for loaded data before enabling edits. Background query refreshes do not replace an active company form draft. Editors load on demand, so opening the directory does not fetch every module's settings.

## Validation

- TypeScript: `tsc --noEmit --incremental false` passed.
- Vite production frontend build passed (existing large main-chunk warning).
- Local browser inspection: category navigation, search for leave approvers, existing leave revisions and editor, team setup and lead access, benefits rule editor, desktop layout and 390 px phone layout. No policy form was submitted.
- No automated tests or audit suite run, following the user's preference.

Prepared locally; not published or deployed as part of this change.
