import { eq, sql } from 'drizzle-orm';
import { learningCourses as courses } from '@shared/schema';
import { courseDefinition } from '@shared/employee-services';
import { inductionContent } from '@shared/induction';
import { hasPermission } from '@shared/permissions';
import {
  publishedOperationsTrainingSettings, sameOperationsTrainingSettings,
  type OperationsTrainingCourse, type OperationsTrainingUpdate,
} from '@shared/operations-training';
import { requireInductionAdmin, inductionCourse, internalDefinition, validateInductionAssets } from './induction';
import { approver, event, versionCheck } from './employee-services';
import { audit } from './hr-rules';
import { fail } from './workforce';
import type { TokenPayload } from './auth';

const draftConflict = 'This course has unpublished author changes. Publish or resolve them in Learning & Training before changing onboarding requirements.';
const activeEnrollmentSql = sql`('requested','approved','in_progress','completion_submitted')`;

export async function operationsTrainingCatalogue(tx: any, user: TokenPayload, input: { q: string; offset: number }) {
  requireInductionAdmin(user);
  const where = sql`c.definition->>'status'='published' AND (${input.q}='' OR strpos(lower(c.definition->>'title'),lower(${input.q}))>0)`;
  const rows = (await tx.execute(sql`
    SELECT c.id,c.version,c.definition->>'title' AS title,c.definition->'capacity' AS capacity,
      d.version AS draft_version,r.id AS release_id,r.release_number,
      jsonb_build_object('mandatoryForOnboarding',r.content->'settings'->'mandatoryForOnboarding',
        'employeeTypes',r.content->'settings'->'employeeTypes','departments',r.content->'settings'->'departments',
        'defaultDueDays',r.content->'settings'->'defaultDueDays',
        'dueDateBasis',coalesce(r.content->'settings'->'dueDateBasis','"enrollment"'::jsonb)) AS requirements,
      (d.course_id IS NULL OR d.content IS DISTINCT FROM r.content OR
        (d.definition-'status') IS DISTINCT FROM (r.definition-'status') OR
        (c.definition-'status') IS DISTINCT FROM (r.definition-'status')) AS has_draft,
      u.role AS approver_role,u.is_active AS approver_active,u.approval_status AS approver_status,
      (SELECT count(*)::int FROM learning_enrollments e WHERE e.course_id=c.id AND e.status IN ${activeEnrollmentSql}) AS active_enrollments
    FROM learning_courses c JOIN learning_induction_courses i ON i.course_id=c.id
    JOIN learning_induction_releases r ON r.id=i.published_release_id AND r.course_id=c.id
    LEFT JOIN learning_induction_drafts d ON d.course_id=c.id
    LEFT JOIN users u ON u.id=(c.definition->>'approverId')::integer
    WHERE ${where} ORDER BY c.id DESC LIMIT 25 OFFSET ${input.offset}
  `)).rows;
  const count = (await tx.execute(sql`
    SELECT count(*)::int AS count FROM learning_courses c JOIN learning_induction_courses i ON i.course_id=c.id
    JOIN learning_induction_releases r ON r.id=i.published_release_id AND r.course_id=c.id WHERE ${where}
  `)).rows[0];
  const items: OperationsTrainingCourse[] = rows.map((row: any) => {
    const blockedReason = row.has_draft ? draftConflict
      : !row.approver_active || row.approver_status !== 'approved' || !hasPermission(row.approver_role, 'training_development', 'approve')
        ? 'Choose an active training approver in the course builder before publishing requirements.'
        : row.capacity !== null && Number(row.active_enrollments) > Number(row.capacity)
          ? 'Course capacity is below active enrollments. Resolve capacity in the course builder first.' : null;
    return {
      id: Number(row.id), title: String(row.title), courseVersion: Number(row.version),
      draftVersion: row.draft_version === null ? null : Number(row.draft_version),
      publishedReleaseId: Number(row.release_id), releaseNumber: Number(row.release_number),
      hasDraft: Boolean(row.has_draft), settings: publishedOperationsTrainingSettings.parse(row.requirements),
      canPublish: blockedReason === null, blockedReason,
    };
  });
  return { items, total: Number(count.count) };
}

/** The caller supplies a transaction. Course locking follows the existing author/publish order. */
export async function publishOperationsTrainingRequirements(tx: any, user: TokenPayload, id: number, input: OperationsTrainingUpdate) {
  requireInductionAdmin(user);
  const course = await inductionCourse(tx, id, true);
  versionCheck(course.version, input.courseVersion);
  if (course.definition.status !== 'published') fail(409, 'Only published internal courses can have onboarding requirements configured here');
  const draft = (await tx.execute(sql`SELECT * FROM learning_induction_drafts WHERE course_id=${id} FOR UPDATE`)).rows[0];
  if (!draft) fail(409, draftConflict);
  versionCheck(Number(draft.version), input.draftVersion);
  const release = (await tx.execute(sql`
    SELECT r.*,
      (d.content IS DISTINCT FROM r.content OR (d.definition-'status') IS DISTINCT FROM (r.definition-'status') OR
        (c.definition-'status') IS DISTINCT FROM (r.definition-'status')) AS has_draft
    FROM learning_induction_courses i JOIN learning_induction_releases r ON r.id=i.published_release_id AND r.course_id=i.course_id
    JOIN learning_induction_drafts d ON d.course_id=i.course_id JOIN learning_courses c ON c.id=i.course_id WHERE i.course_id=${id}
  `)).rows[0];
  if (!release) fail(409, 'Publish this internal course in Learning & Training first');
  if (Number(release.id) !== input.publishedReleaseId) fail(409, 'The published course changed. Refresh before continuing');
  if (release.has_draft) fail(409, draftConflict);
  const previousContent = inductionContent.parse(release.content);
  const previousSettings = publishedOperationsTrainingSettings.parse({
    mandatoryForOnboarding: previousContent.settings.mandatoryForOnboarding,
    employeeTypes: previousContent.settings.employeeTypes,
    departments: previousContent.settings.departments,
    defaultDueDays: previousContent.settings.defaultDueDays,
    dueDateBasis: previousContent.settings.dueDateBasis,
  });
  if (sameOperationsTrainingSettings(previousSettings, input.settings)) {
    return { id, courseVersion: course.version, draftVersion: Number(draft.version), publishedReleaseId: Number(release.id), releaseNumber: Number(release.release_number), settings: previousSettings, changed: false };
  }
  const content = inductionContent.parse({ ...previousContent, settings: { ...previousContent.settings, ...input.settings } });
  const definition = internalDefinition(courseDefinition.parse(release.definition), 'published');
  if (content.lessons.some(lesson => lesson.body.includes('DRAFT AUTHORING INSTRUCTIONS')) || content.questions.some(question => question.prompt.includes('DRAFT QUESTION:') || question.options.some(option => option.text.includes('Replace this option with')))) {
    fail(400, 'Replace the draft authoring instructions and starter question with your actual training before publishing');
  }
  await validateInductionAssets(tx, id, content);
  await approver(tx, definition.approverId, 'training_development');
  const activeCount = Number((await tx.execute(sql`SELECT count(*)::int AS count FROM learning_enrollments WHERE course_id=${id} AND status IN ${activeEnrollmentSql}`)).rows[0].count);
  if (definition.capacity !== null && activeCount > definition.capacity) fail(409, 'Capacity cannot be lower than active enrollments');
  const releaseNumber = Number((await tx.execute(sql`SELECT coalesce(max(release_number),0)+1 AS next FROM learning_induction_releases WHERE course_id=${id}`)).rows[0].next);
  const courseVersion = course.version + 1, draftVersion = Number(draft.version) + 1;
  const savedRelease = (await tx.execute(sql`
    INSERT INTO learning_induction_releases(course_id,release_number,course_version,definition,content,created_by)
    VALUES (${id},${releaseNumber},${courseVersion},${JSON.stringify(definition)}::jsonb,${JSON.stringify(content)}::jsonb,${user.userId}) RETURNING id
  `)).rows[0];
  await tx.execute(sql`UPDATE learning_induction_courses SET published_release_id=${savedRelease.id} WHERE course_id=${id}`);
  await tx.execute(sql`UPDATE learning_induction_drafts SET definition=${JSON.stringify(definition)}::jsonb,content=${JSON.stringify(content)}::jsonb,version=${draftVersion},updated_by=${user.userId},updated_at=now() WHERE course_id=${id}`);
  await tx.update(courses).set({
    definition, version: courseVersion, updatedAt: new Date(),
    history: event(course.history, user, 'Onboarding requirements published', input.reason, courseVersion, {
      previousReleaseId: Number(release.id), releaseId: Number(savedRelease.id), releaseNumber,
      previousSettings, settings: input.settings,
    }),
  }).where(eq(courses.id, id));
  await audit(tx, user, 'induction_course', id, `Published onboarding requirements as release ${releaseNumber}`);
  return { id, courseVersion, draftVersion, publishedReleaseId: Number(savedRelease.id), releaseNumber, settings: input.settings, changed: true };
}
