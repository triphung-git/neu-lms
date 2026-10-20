import type { GradeRevision, RubricCriterion, Course, User } from '../../../shared/kernel/types';

/**
 * Returns the most recently published GradeRevision for a given submission.
 * Fixes non-deterministic selection when multiple revisions exist.
 */
export function getLatestPublishedGrade(
  gradeRevisions: GradeRevision[],
  submissionId: string
): GradeRevision | null {
  const published = gradeRevisions.filter(
    gr => gr.submissionId === submissionId && gr.status === 'published'
  );

  if (published.length === 0) return null;

  return published.sort((a, b) => {
    const timeA = new Date(a.publishedAt || a.createdAt).getTime();
    const timeB = new Date(b.publishedAt || b.createdAt).getTime();
    return timeB - timeA;
  })[0];
}

/**
 * Returns the latest draft GradeRevision for a given submission.
 */
export function getLatestDraftGrade(
  gradeRevisions: GradeRevision[],
  submissionId: string
): GradeRevision | null {
  const drafts = gradeRevisions.filter(
    gr => gr.submissionId === submissionId && gr.status === 'draft'
  );

  if (drafts.length === 0) return null;

  return drafts.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeB - timeA;
  })[0];
}

/**
 * Calculates total rubric score capped at criterion maximums.
 */
export function calculateRubricTotal(
  rubricCriteria: RubricCriterion[] = [],
  scores: Record<string, number> = {}
): number {
  if (rubricCriteria.length === 0) {
    return Object.values(scores).reduce((sum, val) => sum + (Number(val) || 0), 0);
  }

  let total = 0;
  for (const criterion of rubricCriteria) {
    const rawVal = Number(scores[criterion.id]) || 0;
    const boundedVal = Math.min(Math.max(0, rawVal), criterion.maxScore);
    total += boundedVal;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Validates whether the logged-in user is the assigned instructor of the course, or an admin.
 */
export function canTeacherAccessCourse(
  course: Course | null | undefined,
  currentUser: User | null | undefined
): boolean {
  if (!course || !currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'teacher' && course.teacherId === currentUser.id) return true;
  return false;
}
