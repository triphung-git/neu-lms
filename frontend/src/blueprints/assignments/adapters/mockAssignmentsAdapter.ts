import type { AssignmentsPort, Result } from '../contracts/assignmentsPort';
import type { SubmitAssignmentInput, StudentAssignmentDetailViewModel } from '../contracts/assignmentsDto';
import { storageManager } from '../../../infrastructure/persistence/storage';
import { demoClock } from '../../../shared/kernel/clock';
import { checkSubmissionEligibility } from '../domain/assignmentPolicies';
import { getLatestPublishedGrade } from '../../grading/domain/gradingPolicies';
import type { Submission, SubmissionRevision } from '../../../shared/kernel/types';

export class MockAssignmentsAdapter implements AssignmentsPort {
  async getStudentAssignmentDetail(
    assignmentId: string,
    studentId: string
  ): Promise<Result<StudentAssignmentDetailViewModel>> {
    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy bài tập.' } };
    }

    const course = db.courses.find((c) => c.id === assignment.courseId);
    const eligibility = checkSubmissionEligibility(
      assignment,
      course,
      db.memberships,
      studentId,
      demoClock.now()
    );

    const submission = db.submissions.find(
      (s) => s.assignmentId === assignmentId && s.studentId === studentId
    ) || null;

    const publishedGrade = submission
      ? getLatestPublishedGrade(db.gradeRevisions, submission.id)
      : null;

    const isEnrolled = db.memberships.some(
      (m) => m.courseId === assignment.courseId && m.userId === studentId && m.status === 'active'
    );

    return {
      ok: true,
      data: {
        assignment,
        isEnrolled,
        submission,
        publishedGrade,
        canSubmit: eligibility.allowed,
        isLate: eligibility.isLate,
        rejectionReason: eligibility.message
      }
    };
  }

  async submitAssignment(
    input: SubmitAssignmentInput
  ): Promise<Result<{ revisionNumber: number; submittedAt: string }>> {
    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === input.assignmentId);
    const course = assignment ? db.courses.find((c) => c.id === assignment.courseId) : null;

    const nowIso = demoClock.now();
    const eligibility = checkSubmissionEligibility(
      assignment,
      course,
      db.memberships,
      input.studentId,
      nowIso
    );

    if (!eligibility.allowed) {
      return {
        ok: false,
        error: { code: eligibility.reason, message: eligibility.message || 'Không thể nộp bài tập.' }
      };
    }

    let nextRevNumber = 1;
    const nowTime = nowIso;
    const clone = JSON.parse(JSON.stringify(db));

    let existingSub: Submission | undefined = clone.submissions.find(
      (s: Submission) => s.assignmentId === input.assignmentId && s.studentId === input.studentId
    );

    const newRevId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (existingSub) {
      nextRevNumber = (existingSub.revisions.length || 0) + 1;
      const newRev: SubmissionRevision = {
        id: newRevId,
        revisionNumber: nextRevNumber,
        filename: input.file.filename,
        sizeBytes: input.file.size,
        mime: 'application/pdf',
        submittedAt: nowTime,
        isLate: eligibility.isLate
      };
      existingSub.revisions.push(newRev);
      existingSub.latestRevisionId = newRevId;
      existingSub.submittedAt = nowTime;
      existingSub.isLate = eligibility.isLate;
      existingSub.gradingStatus = 'ungraded';
    } else {
      const newSubId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newRev: SubmissionRevision = {
        id: newRevId,
        revisionNumber: 1,
        filename: input.file.filename,
        sizeBytes: input.file.size,
        mime: 'application/pdf',
        submittedAt: nowTime,
        isLate: eligibility.isLate
      };

      existingSub = {
        id: newSubId,
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        submittedAt: nowTime,
        isLate: eligibility.isLate,
        gradingStatus: 'ungraded',
        latestRevisionId: newRevId,
        revisions: [newRev]
      };
      clone.submissions.push(existingSub);
    }

    // Add audit log
    clone.auditLogs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: nowTime,
      actorId: input.studentId,
      actorName: 'Sinh viên',
      actorRole: 'student',
      action: 'SUBMIT_ASSIGNMENT',
      entityType: 'Submission',
      entityId: existingSub.id,
      result: 'success',
      redactedDetails: `Nộp bài tập ${input.assignmentId} (phiên bản ${nextRevNumber})`
    });

    storageManager.saveDatabase(clone);

    return {
      ok: true,
      data: {
        revisionNumber: nextRevNumber,
        submittedAt: nowTime
      }
    };
  }
}

export const mockAssignmentsAdapter = new MockAssignmentsAdapter();
