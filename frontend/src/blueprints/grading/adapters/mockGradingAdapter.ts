import type { GradingPort, Result } from '../contracts/gradingPort';
import type {
  SaveGradeDraftInput,
  PublishGradeInput,
  BulkPublishInput,
  StudentGradeViewModel,
  TeacherGradingSheetViewModel,
  CourseGradebookViewModel
} from '../contracts/gradingDto';
import { storageManager } from '../../../infrastructure/persistence/storage';
import { demoClock } from '../../../shared/kernel/clock';
import {
  getLatestPublishedGrade,
  getLatestDraftGrade,
  canTeacherAccessCourse
} from '../domain/gradingPolicies';
import type { GradeRevision } from '../../../shared/kernel/types';

export class MockGradingAdapter implements GradingPort {
  async getGradingSheet(
    submissionId: string,
    teacherId: string
  ): Promise<Result<TeacherGradingSheetViewModel>> {
    const db = storageManager.getDatabase();
    const submission = db.submissions.find((s) => s.id === submissionId);
    if (!submission) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy bài nộp.' } };
    }

    const assignment = db.assignments.find((a) => a.id === submission.assignmentId);
    const course = assignment ? db.courses.find((c) => c.id === assignment.courseId) : null;
    const teacherUser = db.users.find((u) => u.id === teacherId);

    if (!canTeacherAccessCourse(course, teacherUser)) {
      return {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Bạn không có quyền chấm bài môn học này.' }
      };
    }

    const student = db.users.find((u) => u.id === submission.studentId) || null;
    const revisions = db.gradeRevisions.filter((gr) => gr.submissionId === submissionId);
    const latestDraft = getLatestDraftGrade(revisions, submissionId);
    const latestPublished = getLatestPublishedGrade(revisions, submissionId);

    return {
      ok: true,
      data: {
        submission,
        assignment: assignment!,
        course: course!,
        student,
        revisions,
        latestDraft,
        latestPublished
      }
    };
  }

  async saveDraft(input: SaveGradeDraftInput): Promise<Result<{ revisionId: string }>> {
    const db = storageManager.getDatabase();
    const sub = db.submissions.find((s) => s.id === input.submissionId);
    if (!sub) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy bài nộp.' } };
    }

    const clone = JSON.parse(JSON.stringify(db));
    const targetSub = clone.submissions.find((s: any) => s.id === input.submissionId);
    targetSub.gradingStatus = 'in_progress';

    const latestRev = targetSub.revisions[targetSub.revisions.length - 1];
    const criterionScores: { criterionId: string; score: number }[] = input.rubricScores
      ? Object.entries(input.rubricScores).map(([criterionId, score]) => ({
          criterionId,
          score
        }))
      : [];

    const revId = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = demoClock.now();

    const gradeRev: GradeRevision = {
      id: revId,
      submissionId: input.submissionId,
      submissionRevisionId: latestRev ? latestRev.id : 'rev-1',
      criterionScores,
      feedback: input.feedback || '',
      total: input.score,
      status: 'draft',
      authorId: input.authorId || 'u-gv1',
      createdAt: nowIso
    };

    clone.gradeRevisions.push(gradeRev);
    clone.auditLogs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: nowIso,
      actorId: input.authorId || 'system',
      actorName: 'Giảng viên',
      actorRole: 'teacher',
      action: 'SAVE_GRADE_DRAFT',
      entityType: 'Submission',
      entityId: input.submissionId,
      result: 'success',
      redactedDetails: `Lưu điểm nháp cho bài nộp ${input.submissionId}`
    });

    storageManager.saveDatabase(clone);
    return { ok: true, data: { revisionId: revId } };
  }

  async publishGrade(input: PublishGradeInput): Promise<Result<{ revisionId: string }>> {
    const db = storageManager.getDatabase();
    const sub = db.submissions.find((s) => s.id === input.submissionId);
    if (!sub) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy bài nộp.' } };
    }

    const clone = JSON.parse(JSON.stringify(db));
    const targetSub = clone.submissions.find((s: any) => s.id === input.submissionId);
    targetSub.gradingStatus = 'graded';

    const latestRev = targetSub.revisions[targetSub.revisions.length - 1];
    const criterionScores: { criterionId: string; score: number }[] = input.rubricScores
      ? Object.entries(input.rubricScores).map(([criterionId, score]) => ({
          criterionId,
          score
        }))
      : [];

    const revId = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = demoClock.now();

    const gradeRev: GradeRevision = {
      id: revId,
      submissionId: input.submissionId,
      submissionRevisionId: latestRev ? latestRev.id : 'rev-1',
      criterionScores,
      feedback: input.feedback || '',
      total: input.score,
      status: 'published',
      authorId: input.authorId || 'u-gv1',
      createdAt: nowIso,
      publishedAt: nowIso
    };

    clone.gradeRevisions.push(gradeRev);
    clone.auditLogs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: nowIso,
      actorId: input.authorId || 'system',
      actorName: 'Giảng viên',
      actorRole: 'teacher',
      action: 'PUBLISH_GRADE',
      entityType: 'Submission',
      entityId: input.submissionId,
      result: 'success',
      redactedDetails: `Công bố điểm cho bài nộp ${input.submissionId}`
    });

    storageManager.saveDatabase(clone);
    return { ok: true, data: { revisionId: revId } };
  }

  async bulkPublishGrades(input: BulkPublishInput): Promise<Result<{ publishedCount: number }>> {
    const db = storageManager.getDatabase();
    const clone = JSON.parse(JSON.stringify(db));
    const nowIso = demoClock.now();
    let count = 0;

    for (const item of input.items) {
      const targetSub = clone.submissions.find((s: any) => s.id === item.submissionId);
      if (!targetSub) continue;

      targetSub.gradingStatus = 'graded';
      const latestRev = targetSub.revisions[targetSub.revisions.length - 1];
      const criterionScores: { criterionId: string; score: number }[] = item.rubricScores
        ? Object.entries(item.rubricScores).map(([criterionId, score]) => ({
            criterionId,
            score
          }))
        : [];

      const revId = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const gradeRev: GradeRevision = {
        id: revId,
        submissionId: item.submissionId,
        submissionRevisionId: latestRev ? latestRev.id : 'rev-1',
        criterionScores,
        feedback: item.feedback || '',
        total: item.score,
        status: 'published',
        authorId: 'u-gv1',
        createdAt: nowIso,
        publishedAt: nowIso
      };

      clone.gradeRevisions.push(gradeRev);
      count++;
    }

    if (count > 0) {
      clone.auditLogs.unshift({
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        at: nowIso,
        actorId: 'u-gv1',
        actorName: 'Giảng viên',
        actorRole: 'teacher',
        action: 'BULK_PUBLISH_GRADES',
        entityType: 'Assignment',
        entityId: input.assignmentId,
        result: 'success',
        redactedDetails: `Công bố điểm hàng loạt cho ${count} bài nộp của bài tập ${input.assignmentId}`
      });

      storageManager.saveDatabase(clone);
    }

    return { ok: true, data: { publishedCount: count } };
  }

  async getStudentGrade(
    assignmentId: string,
    studentId: string
  ): Promise<Result<StudentGradeViewModel | null>> {
    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy bài tập.' } };
    }

    const course = db.courses.find((c) => c.id === assignment.courseId);
    const sub = db.submissions.find(
      (s) => s.assignmentId === assignmentId && s.studentId === studentId
    );

    const pubGrade = sub ? getLatestPublishedGrade(db.gradeRevisions, sub.id) : null;

    return {
      ok: true,
      data: {
        assignmentId,
        assignmentTitle: assignment.title,
        courseId: assignment.courseId,
        courseCode: course?.code || '',
        dueAt: assignment.dueAt,
        submittedAt: sub?.submittedAt,
        isGraded: !!pubGrade,
        publishedGrade: pubGrade
          ? {
              total: pubGrade.total,
              criterionScores: pubGrade.criterionScores,
              feedback: pubGrade.feedback,
              publishedAt: pubGrade.publishedAt || pubGrade.createdAt
            }
          : null
      }
    };
  }

  async getCourseGradebook(
    courseId: string,
    teacherId: string
  ): Promise<Result<CourseGradebookViewModel>> {
    const db = storageManager.getDatabase();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy môn học.' } };
    }

    const teacher = db.users.find((u) => u.id === teacherId);
    if (!canTeacherAccessCourse(course, teacher)) {
      return {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Bạn không có quyền xem bảng điểm môn học này.' }
      };
    }

    const assignments = db.assignments.filter(
      (a) => a.courseId === courseId && a.status === 'published'
    );
    const memberships = db.memberships.filter((m) => m.courseId === courseId);

    const rows = memberships.map((m) => {
      const user = db.users.find((u) => u.id === m.userId);
      const grades: Record<string, { total: number; isPublished: boolean } | null> = {};

      for (const ass of assignments) {
        const sub = db.submissions.find(
          (s) => s.assignmentId === ass.id && s.studentId === m.userId
        );
        if (!sub) {
          grades[ass.id] = null;
          continue;
        }

        const pub = getLatestPublishedGrade(db.gradeRevisions, sub.id);
        if (pub) {
          grades[ass.id] = { total: pub.total, isPublished: true };
        } else {
          const draft = getLatestDraftGrade(db.gradeRevisions, sub.id);
          grades[ass.id] = draft ? { total: draft.total, isPublished: false } : null;
        }
      }

      return {
        userId: m.userId || '',
        userName: user?.fullName || m.emailNormalized,
        userEmail: m.emailNormalized,
        isWithdrawn: m.status === 'withdrawn',
        grades
      };
    });

    return {
      ok: true,
      data: {
        course,
        assignments,
        rows
      }
    };
  }
}

export const mockGradingAdapter = new MockGradingAdapter();
