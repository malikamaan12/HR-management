# Learning experience refresh — 23 September 2026

## Learner experience

- Academy opens with an image-led catalog, search and filters for all courses, required induction and self-enrollment.
- Course cards show the provider, duration, lesson count and the learner's actual enrollment progress. Actions change to Start, Continue, Awaiting approval or Review course as appropriate.
- A course preview explains the course and its approval requirements. Eligible employees can enroll and open their assigned course directly; existing server-side eligibility and approval rules remain authoritative.
- My learning uses progress cards, status filters and certificate links. The resume banner opens an existing approved or in-progress enrollment.
- The lesson player has a visual lesson path, previous/next navigation, progress and a focused quiz showing one question at a time. Lesson acknowledgment, sequential access, scoring, submission and review rules are preserved.
- External training also uses image cards, while HR retains its enrollment and management workflows.
- Responsive layouts support phones, with horizontal lesson navigation and a single-column course catalog. Existing reduced-motion support applies.

## Course management and images

- Course administration is grouped under Manage, with publishing, assignments, the safety library and academy branding still protected by existing roles.
- Course editors can select from six generated covers, use automatic title-based artwork or specify an HTTPS image URL. A failed custom image falls back to the preset artwork.
- Optional cover fields are stored in existing JSON definitions and release snapshots; no database migration is required. Existing courses receive automatic artwork without rewriting their records. Published course changes still use the existing draft/publish process.
- Artwork files and full generation prompts are listed in [Learning-Cover-Prompts-2026-09-23.md](Learning-Cover-Prompts-2026-09-23.md). Website assets total approximately 211 KB in WebP format.
- Authoring, reporting and player panels load on demand.

## Validation and delivery

- TypeScript compilation and production frontend/backend builds completed successfully.
- Manually viewed the local synthetic catalog and course preview at desktop and phone sizes. The preview administrator has no linked employee profile, so the course preview correctly explains why self-enrollment is unavailable for that account.
- No automated tests or audit suites were run, in accordance with the user's preference. No live enrollment, attendance, quiz score or certificate data was changed.
- Local preview: http://127.0.0.1:5191/learning. These changes are not deployed.
