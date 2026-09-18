# Internal employee induction and training

Implementation status: 19 September 2026, included in the [combined safety, attendance and compensation source batch](Safety-Attendance-Compensation-Release.md). TypeScript and client/server production builds passed. Functional tests, migration execution, browser acceptance and production deployment remain deferred at the owner's request. This guide describes the implemented workflows, not verified production acceptance.

## Hosting and costs

The academy runs inside the existing React client, Express server and PostgreSQL database. It adds no dependency, LMS vendor, subscription, third-party licensing fee, external video embed or paid service. Text lessons, quizzes, scores and completion records use the existing application/database. Uploaded media uses the already configured private S3-compatible storage; it does not create a new account, bucket or hosting resource.

The initial module media budget is 100 MB, with a 20 MB per-file limit. Administrators can set a 0–512 MB module budget and a 1–40 MB file limit. Setting the budget to zero disables additional uploads while text lessons and quizzes continue working. Logos are limited to 2 MB. These are application usage controls, not reservations of provider capacity: documents and other modules share the existing storage, and provider storage, traffic and database quotas still apply. No billing or plan change is performed by this feature.

## Author and publish a course

1. Open **Learning → Induction & training → Course catalogue**. HR, HR directors and administrators can create and edit courses.
2. Enter the real title, description, provider/company and completion reviewer. Save a draft to create its private media library. Starter authoring instructions are placeholders and must be replaced before publication.
3. Add ordered plain-text, PDF/image or MP4/WebM lessons. Upload media directly to the existing private storage. Mark required lessons, set estimated duration and choose whether learners must follow the sequence. External URLs and executable lesson HTML are not used.
4. Create single-answer, multiple-answer or true/false questions, with correct options and point values. Configure question-bank sampling, randomization, pass percentage, attempt count, retry delay and quiz time limit. Answer keys are stored on the server and are omitted from learner responses.
5. Configure employee types and optional departments, self-enrollment, enrollment approval, completion review, deadlines and certificate validity. Temporary/event staff use the temporary employee category. Mark a course as required for onboarding where appropriate.
6. Save, then publish separately. Each publication creates an immutable release. Already assigned employees keep their saved release, content and rules. Archive a course to stop new enrollments while retaining existing training history.

Course content is limited to 60 lessons, 100 questions and 400,000 serialized characters per release. Each question supports up to eight options. Split longer programs into several courses. Files referenced by a published release or certificate remain protected; authors can remove unused uploads after saving the removal of any draft references.

## Assignment and learner workflow

HR can assign one course release to up to 100 employees per operation, with a due date, required flag and recorded reason. Audience, employment, scope and capacity rules apply. Open assignments are reused instead of duplicated. A valid completion can satisfy an existing requirement; failed training can be deliberately reassigned by HR, preserving earlier attempts. Learners cannot self-enroll repeatedly to reset an exhausted quiz allowance.

Employees see **My learning**, open their lessons and acknowledge completion. Required lesson completion unlocks the quiz. The server starts an attempt, stores its selected question/option order and enforces its expiry. Answers remain in the browser until submitted; closing or reloading the page does not save unsubmitted answers or pause the timer. A lost submission response can be recovered from the saved attempt record. Scores are calculated from the stored answer key, with all correct options and no extra options required for a multiple-answer question.

Lesson progress contributes up to 90%; a passing quiz reaches 100%. If completion review is enabled, the passing record goes to the assigned independent reviewer. That reviewer can return the completion for correction or verify the stored result; they cannot type a replacement quiz score. Returned passing completions can be resubmitted. Exhausted attempts close the assignment as failed. Scoped HR can record an independent exemption with a reason; exemption does not manufacture a passing score or a completion certificate.

Completion creates a printable branded certificate with a saved company identity, certificate reference, completion date, score and optional validity date. Printing to PDF uses the browser. No paid certificate service is involved. Certificates and course media require the existing authenticated employee/HR access; file links are short-lived signed redirects.

## Onboarding and reporting

Starting onboarding automatically assigns published mandatory courses matching the employee type/department. Open onboarding workflows can use **Assign newly published required induction courses** to apply courses published after the workflow started. Existing assignments and valid completions are preserved.

Outstanding required assignments appear in the onboarding checklist with progress, status, due date and a link to the training record. Onboarding completion is blocked until these are completed or independently exempted. Course completion reviews must finish before a training record counts as complete.

The academy includes personal records and scoped team reports with filters, completion/overdue counts, scores, attempt details and CSV export. Team leads/managers with training update or approval permissions can view their scoped team reports. Authoring and bulk assignment remain restricted to HR roles; company branding and media-budget changes require administrator/superadministrator access. Existing learning deadline reminders include internal enrollments using their normal saved status and due dates.

## Branding and configuration

Administrators can change the organization name, academy title, welcome text, accent color, private logo, certificate title/prefix and signatory label. Branding/media changes retain history and use version checks. Completed certificates keep their saved branding rather than changing when the company updates the academy.

Course editing also uses separate course/draft versions. A newer saved version prompts authors to reload deliberately instead of silently replacing unsaved work. Existing manually recorded training remains available under **Other training & approvals**. Internal enrollments are routed to the learner player, and legacy progress/manual-score actions are blocked on the server for internal courses.

## Release handoff

Migration `0038_internal_induction.sql` adds private course drafts, immutable releases, assets, branding, release-pinned enrollments, lesson progress and quiz attempts. It extends the existing learning tables and migrations 0000–0037. No production employee, course, policy, score or completion records have been seeded or changed.

The deferred combined validation phase should cover migration upgrades, author/learner/reviewer scoping, release and branding preservation, concurrent enrollment and submissions, quiz expiry/retries/scoring, private media and budgets, onboarding blockers/exemptions, reports and certificates. Run the existing typecheck/build and role-based browser acceptance after implementation, then fix any findings before release. Actual company induction content must be authored and published by HR.
