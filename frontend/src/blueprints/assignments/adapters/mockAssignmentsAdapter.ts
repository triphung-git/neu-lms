/**
 * Mock Adapter for Assignments Domain (B10).
 *
 * Implements AssignmentsPort using browser mock database storage and demo clock.
 * Retained for isolated tests and demo-only callers; product wiring uses the HTTP
 * adapter. Its submission behavior is not the B11 persistence pipeline.
 *
 * Invariants Enforced:
 * - Statement and rubric criteria are immutable once published.
 * - Post-publish edits allow deadline, allowLate, versioned file policy, AI opt-in.
 * - Optimistic locking via version / timestamp check.
 * - Server-authoritative eligibility checks.
 */

import type { AssignmentsPort } from '../contracts/assignmentsPort';
import type {
  Result,
  RequestContext,
  PaginatedResult,
  AssignmentSummaryItem,
  AssignmentDetail,
  AssignmentListFilters,
  CreateAssignmentInput,
  UpdateAssignmentInput,
  PublishAssignmentInput,
  CloseAssignmentInput,
  StudentAssignmentView,
  StudentAssignmentEligibility,
  SubmitAssignmentInput,
  StudentAssignmentDetailViewModel,
  RubricCriterionDto,
  AssignmentFilePolicyDto,
  AssignmentAttachmentDto,
} from '../contracts/assignmentsDto';
import { DEFAULT_ASSIGNMENT_FILE_POLICY } from '../contracts/assignmentsDto';
import { storageManager } from '../../../infrastructure/persistence/storage';
import { demoClock } from '../../../shared/kernel/clock';
import { checkSubmissionEligibility } from '../domain/assignmentPolicies';
import { getLatestPublishedGrade } from '../../grading/domain/gradingPolicies';
import type { Submission, SubmissionRevision } from '../../../shared/kernel/types';

export class MockAssignmentsAdapter implements AssignmentsPort {
  // =========================================================================
  // Teacher Operations
  // =========================================================================

  async listTeacherAssignments(
    courseId: string,
    filters?: AssignmentListFilters,
    ctx?: RequestContext
  ): Promise<Result<PaginatedResult<AssignmentSummaryItem>>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Môn học không tồn tại.' } };
    }

    let items = db.assignments.filter((a) => a.courseId === courseId);

    // Filter by status
    if (filters?.status && filters.status !== 'all') {
      items = items.filter((a) => a.status === filters.status);
    }

    // Filter by chapter
    if (filters?.chapterId) {
      items = items.filter((a) => (a as any).chapterId === filters.chapterId);
    }

    // Filter by search
    if (filters?.search) {
      const q = filters.search.trim().toLowerCase();
      items = items.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.instructions && a.instructions.toLowerCase().includes(q))
      );
    }

    const page = Math.max(1, filters?.page || 1);
    const pageSize = Math.max(1, filters?.pageSize || 10);
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const paginatedSlice = items.slice((page - 1) * pageSize, page * pageSize);

    const summaryItems: AssignmentSummaryItem[] = paginatedSlice.map((a) => {
      const submissions = db.submissions.filter((s) => s.assignmentId === a.id);
      const gradedCount = submissions.filter((s) => s.gradingStatus === 'graded').length;
      const totalScore = (a.rubricCriteria || []).reduce(
        (sum, crit) => sum + (Number(crit.maxScore) || 0),
        0
      );

      return {
        id: a.id,
        courseId: a.courseId,
        chapterId: (a as any).chapterId || null,
        title: a.title,
        status: a.status as any,
        dueAt: a.dueAt,
        allowLate: a.allowLate,
        manuallyClosedAt: a.manuallyClosedAt || null,
        totalScore: totalScore || a.maxScore || 10,
        rubricCount: a.rubricCriteria?.length || 0,
        attachmentCount: a.attachments?.length || 0,
        submissionCount: submissions.length,
        gradedCount,
        aiGradingOptIn: Boolean((a as any).aiGradingOptIn),
        publishedAt: a.status === 'published' ? a.dueAt : null,
        createdAt: (a as any).createdAt || a.dueAt,
        updatedAt: (a as any).updatedAt || a.dueAt,
        version: (a as any).version || 1,
      };
    });

    return {
      ok: true,
      data: {
        items: summaryItems,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
        },
      },
    };
  }

  async getTeacherAssignmentDetail(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId && a.courseId === courseId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy bài tập.' } };
    }

    const rubricCriteria: RubricCriterionDto[] = (assignment.rubricCriteria || []).map(
      (c, idx) => ({
        id: c.id || `crit-${idx + 1}`,
        title: c.title,
        description: c.description,
        maxScore: Number(c.maxScore) || 0,
        position: idx + 1,
      })
    );

    const totalScore = rubricCriteria.reduce((sum, c) => sum + c.maxScore, 0) || assignment.maxScore || 10;

    const filePolicy: AssignmentFilePolicyDto = (assignment as any).filePolicy || {
      ...DEFAULT_ASSIGNMENT_FILE_POLICY,
    };

    const attachments: AssignmentAttachmentDto[] = (assignment.attachments || []).map((att, idx) => ({
      id: att.assetId || `att-${idx + 1}`,
      filename: att.name,
      sizeBytes: att.sizeBytes,
      mimeType: 'application/pdf',
      downloadUrl: `/api/v1/files/download/${att.assetId || att.name}`,
    }));

    return {
      ok: true,
      data: {
        id: assignment.id,
        courseId: assignment.courseId,
        chapterId: (assignment as any).chapterId || null,
        title: assignment.title,
        instructions: assignment.instructions || '',
        status: assignment.status as any,
        dueAt: assignment.dueAt,
        allowLate: assignment.allowLate,
        manuallyClosedAt: assignment.manuallyClosedAt || null,
        rubricCriteria,
        totalScore,
        filePolicy,
        attachments,
        aiGradingOptIn: Boolean((assignment as any).aiGradingOptIn),
        publishedAt: assignment.status === 'published' ? assignment.dueAt : null,
        createdAt: (assignment as any).createdAt || assignment.dueAt,
        updatedAt: (assignment as any).updatedAt || assignment.dueAt,
        version: (assignment as any).version || 1,
      },
    };
  }

  async createAssignment(
    input: CreateAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    if (!input.title || !input.title.trim()) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Tiêu đề bài tập không được để trống.',
          fieldErrors: { title: ['Tiêu đề bài tập không được để trống.'] },
        },
      };
    }

    if (!input.dueAt) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Hạn nộp bài tập không được để trống.',
          fieldErrors: { dueAt: ['Hạn nộp bài tập không được để trống.'] },
        },
      };
    }

    const db = storageManager.getDatabase();
    const course = db.courses.find((c) => c.id === input.courseId);
    if (!course) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Môn học không tồn tại.' } };
    }
    if (course.status === 'archived') {
      return {
        ok: false,
        error: { code: 'COURSE_ARCHIVED', message: 'Môn học đã lưu trữ, không thể tạo bài tập mới.' },
      };
    }

    const clone = JSON.parse(JSON.stringify(db));
    const nowIso = demoClock.now();
    const newId = `ass-${Date.now()}`;

    const rubricCriteria: RubricCriterionDto[] = (input.rubricCriteria || []).map((c, idx) => ({
      id: c.id || `crit-${Date.now()}-${idx + 1}`,
      title: c.title,
      description: c.description || '',
      maxScore: Number(c.maxScore) || 0,
      position: idx + 1,
    }));

    const totalScore = rubricCriteria.reduce((sum, c) => sum + c.maxScore, 0) || 10;
    const initialStatus = input.publishImmediately ? 'published' : 'draft';

    const filePolicy: AssignmentFilePolicyDto = {
      ...DEFAULT_ASSIGNMENT_FILE_POLICY,
      ...(input.filePolicy || {}),
    };

    const newAssignment: any = {
      id: newId,
      courseId: input.courseId,
      chapterId: input.chapterId || null,
      title: input.title.trim(),
      instructions: input.instructions || '',
      status: initialStatus,
      dueAt: input.dueAt,
      allowLate: Boolean(input.allowLate),
      rubricCriteria,
      maxScore: totalScore,
      attachments: [],
      filePolicy,
      aiGradingOptIn: Boolean(input.aiGradingOptIn),
      createdAt: nowIso,
      updatedAt: nowIso,
      publishedAt: input.publishImmediately ? nowIso : null,
      version: 1,
    };

    clone.assignments.push(newAssignment);

    // Audit log
    clone.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      at: nowIso,
      actorId: 'current-teacher',
      actorName: 'Giảng viên',
      actorRole: 'teacher',
      action: 'CREATE_ASSIGNMENT',
      entityType: 'Assignment',
      entityId: newId,
      result: 'success',
      redactedDetails: `Tạo bài tập mới "${newAssignment.title}" (${initialStatus})`,
    });

    storageManager.saveDatabase(clone);

    return {
      ok: true,
      data: {
        id: newAssignment.id,
        courseId: newAssignment.courseId,
        chapterId: newAssignment.chapterId,
        title: newAssignment.title,
        instructions: newAssignment.instructions,
        status: newAssignment.status,
        dueAt: newAssignment.dueAt,
        allowLate: newAssignment.allowLate,
        manuallyClosedAt: null,
        rubricCriteria,
        totalScore,
        filePolicy,
        attachments: [],
        aiGradingOptIn: newAssignment.aiGradingOptIn,
        publishedAt: newAssignment.publishedAt,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      },
    };
  }

  async updateAssignment(
    courseId: string,
    assignmentId: string,
    input: UpdateAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId && a.courseId === courseId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Bài tập không tồn tại.' } };
    }

    const course = db.courses.find((c) => c.id === courseId);
    if (course?.status === 'archived') {
      return {
        ok: false,
        error: { code: 'COURSE_ARCHIVED', message: 'Môn học đã lưu trữ, không thể chỉnh sửa bài tập.' },
      };
    }

    const isPublished = assignment.status === 'published' || assignment.status === 'archived';

    // Invariant: Once published, title/instructions/rubric cannot be modified retroactively!
    if (isPublished) {
      if (input.title !== undefined && input.title.trim() !== assignment.title) {
        return {
          ok: false,
          error: {
            code: 'IMMUTABLE_AFTER_PUBLISH',
            message: 'Đề bài đã công bố không được phép sửa đổi tiêu đề hồi tố.',
          },
        };
      }
      if (input.instructions !== undefined && input.instructions !== assignment.instructions) {
        return {
          ok: false,
          error: {
            code: 'IMMUTABLE_AFTER_PUBLISH',
            message: 'Đề bài đã công bố không được phép sửa đổi nội dung yêu cầu hồi tố.',
          },
        };
      }
      if (input.rubricCriteria !== undefined) {
        return {
          ok: false,
          error: {
            code: 'IMMUTABLE_AFTER_PUBLISH',
            message: 'Tiêu chí rubric đã công bố không được phép sửa đổi hồi tố.',
          },
        };
      }
    }

    const clone = JSON.parse(JSON.stringify(db));
    const target = clone.assignments.find((a: any) => a.id === assignmentId);
    const nowIso = demoClock.now();

    // Optimistic concurrency check
    const currentVersion = (target.version as number) || 1;
    if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
      return {
        ok: false,
        error: {
          code: 'CONFLICT',
          message: 'Bài tập đã được cập nhật bởi một phiên làm việc khác. Vui lòng tải lại dữ liệu.',
        },
      };
    }

    if (!isPublished) {
      if (input.title !== undefined) target.title = input.title.trim();
      if (input.instructions !== undefined) target.instructions = input.instructions;
      if (input.chapterId !== undefined) target.chapterId = input.chapterId;
      if (input.rubricCriteria !== undefined) {
        target.rubricCriteria = input.rubricCriteria;
        target.maxScore = input.rubricCriteria.reduce(
          (sum: number, c: any) => sum + (Number(c.maxScore) || 0),
          0
        );
      }
    }

    // Allowed post-publish fields
    if (input.dueAt !== undefined) target.dueAt = input.dueAt;
    if (input.allowLate !== undefined) target.allowLate = input.allowLate;
    if (input.filePolicy !== undefined) {
      target.filePolicy = { ...(target.filePolicy || DEFAULT_ASSIGNMENT_FILE_POLICY), ...input.filePolicy };
    }
    if (input.aiGradingOptIn !== undefined) target.aiGradingOptIn = input.aiGradingOptIn;

    target.updatedAt = nowIso;
    target.version = currentVersion + 1;

    clone.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      at: nowIso,
      actorId: 'current-teacher',
      actorName: 'Giảng viên',
      actorRole: 'teacher',
      action: 'UPDATE_ASSIGNMENT',
      entityType: 'Assignment',
      entityId: assignmentId,
      result: 'success',
      redactedDetails: `Cập nhật bài tập "${target.title}" (phiên bản ${target.version})`,
    });

    storageManager.saveDatabase(clone);

    const rubricList: RubricCriterionDto[] = (target.rubricCriteria || []).map((c: any, idx: number) => ({
      id: c.id || `crit-${idx + 1}`,
      title: c.title,
      description: c.description || '',
      maxScore: Number(c.maxScore) || 0,
      position: idx + 1,
    }));

    return {
      ok: true,
      data: {
        id: target.id,
        courseId: target.courseId,
        chapterId: target.chapterId || null,
        title: target.title,
        instructions: target.instructions,
        status: target.status,
        dueAt: target.dueAt,
        allowLate: target.allowLate,
        manuallyClosedAt: target.manuallyClosedAt || null,
        rubricCriteria: rubricList,
        totalScore: rubricList.reduce((sum, c) => sum + c.maxScore, 0) || target.maxScore || 10,
        filePolicy: target.filePolicy || DEFAULT_ASSIGNMENT_FILE_POLICY,
        attachments: target.attachments || [],
        aiGradingOptIn: Boolean(target.aiGradingOptIn),
        publishedAt: target.publishedAt || null,
        createdAt: target.createdAt || target.dueAt,
        updatedAt: nowIso,
        version: target.version,
      },
    };
  }

  async publishAssignment(
    courseId: string,
    input: PublishAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.courseId === courseId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Bài tập không tồn tại.' } };
    }

    if (assignment.status === 'published') {
      return this.getTeacherAssignmentDetail(courseId, input.assignmentId, ctx);
    }

    const clone = JSON.parse(JSON.stringify(db));
    const target = clone.assignments.find((a: any) => a.id === input.assignmentId);
    const nowIso = demoClock.now();

    target.status = 'published';
    target.publishedAt = nowIso;
    target.updatedAt = nowIso;
    target.version = ((target.version as number) || 1) + 1;

    clone.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      at: nowIso,
      actorId: 'current-teacher',
      actorName: 'Giảng viên',
      actorRole: 'teacher',
      action: 'PUBLISH_ASSIGNMENT',
      entityType: 'Assignment',
      entityId: input.assignmentId,
      result: 'success',
      redactedDetails: `Công bố bài tập "${target.title}"`,
    });

    storageManager.saveDatabase(clone);

    return this.getTeacherAssignmentDetail(courseId, input.assignmentId, ctx);
  }

  async closeAssignment(
    courseId: string,
    input: CloseAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === input.assignmentId && a.courseId === courseId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Bài tập không tồn tại.' } };
    }

    const clone = JSON.parse(JSON.stringify(db));
    const target = clone.assignments.find((a: any) => a.id === input.assignmentId);
    const nowIso = demoClock.now();

    if (input.closeType === 'manual_close') {
      target.status = 'archived'; // closed
      target.manuallyClosedAt = nowIso;
    } else {
      // Reopen
      target.status = 'published';
      target.manuallyClosedAt = null;
      if (input.reopenUntil) {
        target.reopenUntil = input.reopenUntil;
      }
    }

    target.updatedAt = nowIso;
    target.version = ((target.version as number) || 1) + 1;

    clone.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      at: nowIso,
      actorId: 'current-teacher',
      actorName: 'Giảng viên',
      actorRole: 'teacher',
      action: input.closeType === 'manual_close' ? 'CLOSE_ASSIGNMENT' : 'REOPEN_ASSIGNMENT',
      entityType: 'Assignment',
      entityId: input.assignmentId,
      result: 'success',
      redactedDetails: `${input.closeType === 'manual_close' ? 'Đóng nhận bài nộp' : 'Mở lại bài tập'}: ${input.reason || 'Theo quyết định giảng viên'}`,
    });

    storageManager.saveDatabase(clone);

    return this.getTeacherAssignmentDetail(courseId, input.assignmentId, ctx);
  }

  async previewAssignmentAsStudent(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>> {
    const detailRes = await this.getTeacherAssignmentDetail(courseId, assignmentId, ctx);
    if (!detailRes.ok) return detailRes;

    const a = detailRes.data;
    const nowIso = demoClock.now();

    return {
      ok: true,
      data: {
        assignment: {
          id: a.id,
          courseId: a.courseId,
          courseTitle: 'Môn học xem trước',
          chapterTitle: null,
          title: a.title,
          instructions: a.instructions,
          dueAt: a.dueAt,
          allowLate: a.allowLate,
          manuallyClosedAt: a.manuallyClosedAt,
          rubricCriteria: a.rubricCriteria,
          totalScore: a.totalScore,
          filePolicy: a.filePolicy,
          attachments: a.attachments,
          publishedAt: a.publishedAt || a.dueAt,
        },
        eligibility: {
          canSubmit: true,
          isLate: false,
          isClosed: false,
          serverTime: nowIso,
        },
        submission: null,
        publishedGrade: null,
      },
    };
  }

  // =========================================================================
  // Student Operations (Server-Authoritative)
  // =========================================================================

  async listStudentAssignments(
    courseId: string,
    filters?: AssignmentListFilters,
    ctx?: RequestContext
  ): Promise<Result<PaginatedResult<AssignmentSummaryItem>>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    let items = db.assignments.filter(
      (a: any) => a.courseId === courseId && (a.status === 'published' || a.status === 'closed' || a.status === 'archived')
    );

    if (filters?.chapterId) {
      items = items.filter((a: any) => a.chapterId === filters.chapterId);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      items = items.filter((a: any) => a.title.toLowerCase().includes(q));
    }

    const mapped: AssignmentSummaryItem[] = items.map((a: any) => ({
      id: a.id,
      courseId: a.courseId,
      chapterId: a.chapterId || null,
      title: a.title,
      status: a.status as any,
      dueAt: a.dueAt,
      allowLate: a.allowLate,
      manuallyClosedAt: a.manuallyClosedAt || null,
      totalScore: a.maxScore || 10,
      rubricCount: a.rubricCriteria?.length || 0,
      attachmentCount: a.attachments?.length || 0,
      submissionCount: 0,
      gradedCount: 0,
      aiGradingOptIn: Boolean(a.aiGradingOptIn),
      publishedAt: a.publishedAt || a.dueAt,
      createdAt: a.createdAt || a.dueAt,
      updatedAt: a.updatedAt || a.dueAt,
      version: a.version || 1,
    }));

    return {
      ok: true,
      data: {
        items: mapped,
        pagination: {
          page: filters?.page || 1,
          pageSize: filters?.pageSize || 20,
          totalItems: mapped.length,
          totalPages: 1,
        },
      },
    };
  }

  async getStudentAssignmentDirect(
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>> {
    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Bài tập không tồn tại.' } };
    }
    return this.getStudentAssignment(assignment.courseId, assignmentId, ctx);
  }

  async getStudentAssignment(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId && a.courseId === courseId);
    if (!assignment || assignment.status !== 'published') {
      return {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Bài tập không tồn tại hoặc chưa được công bố.',
        },
      };
    }

    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Môn học không tồn tại.' } };
    }

    // Server-authoritative: resolve student session from session manager
    const session = storageManager.getSession();
    const studentId = session?.userId || '';

    const eligibilityRes = await this.checkStudentEligibility(courseId, assignmentId, ctx);
    const eligibility: StudentAssignmentEligibility = eligibilityRes.ok
      ? eligibilityRes.data
      : {
          canSubmit: false,
          isLate: false,
          isClosed: true,
          reason: 'UNKNOWN',
          message: 'Không thể xác định điều kiện nộp bài.',
          serverTime: demoClock.now(),
        };

    const submission = db.submissions.find(
      (s) => s.assignmentId === assignmentId && s.studentId === studentId
    ) || null;

    const publishedGrade = submission
      ? getLatestPublishedGrade(db.gradeRevisions, submission.id)
      : null;

    const rubricCriteria: RubricCriterionDto[] = (assignment.rubricCriteria || []).map((c, idx) => ({
      id: c.id || `crit-${idx + 1}`,
      title: c.title,
      description: c.description || '',
      maxScore: Number(c.maxScore) || 0,
      position: idx + 1,
    }));

    const totalScore = rubricCriteria.reduce((sum, c) => sum + c.maxScore, 0) || assignment.maxScore || 10;
    const filePolicy: AssignmentFilePolicyDto = (assignment as any).filePolicy || DEFAULT_ASSIGNMENT_FILE_POLICY;

    const attachments: AssignmentAttachmentDto[] = (assignment.attachments || []).map((att, idx) => ({
      id: att.assetId || `att-${idx + 1}`,
      filename: att.name,
      sizeBytes: att.sizeBytes,
      mimeType: 'application/pdf',
      downloadUrl: `/api/v1/files/download/${att.assetId || att.name}`,
    }));

    return {
      ok: true,
      data: {
        assignment: {
          id: assignment.id,
          courseId: assignment.courseId,
          courseTitle: course.name,
          chapterTitle: null,
          title: assignment.title,
          instructions: assignment.instructions || '',
          dueAt: assignment.dueAt,
          allowLate: assignment.allowLate,
          manuallyClosedAt: assignment.manuallyClosedAt || null,
          rubricCriteria,
          totalScore,
          filePolicy,
          attachments,
          publishedAt: assignment.dueAt,
        },
        eligibility,
        submission: submission
          ? {
              id: submission.id,
              status: submission.gradingStatus,
              submittedAt: submission.submittedAt,
              revisionCount: submission.revisions.length,
              latestRevision: submission.revisions[submission.revisions.length - 1],
            }
          : null,
        publishedGrade: publishedGrade
          ? {
              score: publishedGrade.total,
              totalScore,
              feedback: publishedGrade.feedback,
              publishedAt: publishedGrade.publishedAt || publishedGrade.createdAt,
              revisionNumber: 1,
            }
          : null,
      },
    };
  }

  async checkStudentEligibility(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentEligibility>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId && a.courseId === courseId);
    const course = db.courses.find((c) => c.id === courseId);
    const session = storageManager.getSession();
    const studentId = session?.userId || '';
    const nowIso = demoClock.now();

    const check = checkSubmissionEligibility(assignment, course, db.memberships, studentId, nowIso);

    const isClosed = !check.allowed && (check.reason === 'DEADLINE_PASSED' || check.reason === 'COURSE_ARCHIVED');

    return {
      ok: true,
      data: {
        canSubmit: check.allowed,
        isLate: check.isLate,
        isClosed,
        reason: check.reason as any,
        message: check.message,
        serverTime: nowIso,
      },
    };
  }

  // =========================================================================
  // Legacy Overload for Backwards Compatibility
  // =========================================================================

  async getStudentAssignmentDetail(
    assignmentId: string,
    studentId?: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentDetailViewModel>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

    const db = storageManager.getDatabase();
    const assignment = db.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy bài tập.' } };
    }

    const course = db.courses.find((c) => c.id === assignment.courseId);
    const activeStudentId = studentId || storageManager.getSession()?.userId || '';

    const eligibility = checkSubmissionEligibility(
      assignment,
      course,
      db.memberships,
      activeStudentId,
      demoClock.now()
    );

    const submission = db.submissions.find(
      (s) => s.assignmentId === assignmentId && s.studentId === activeStudentId
    ) || null;

    const publishedGrade = submission
      ? getLatestPublishedGrade(db.gradeRevisions, submission.id)
      : null;

    const isEnrolled = db.memberships.some(
      (m) => m.courseId === assignment.courseId && m.userId === activeStudentId && m.status === 'active'
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
        rejectionReason: eligibility.message,
      },
    };
  }

  // =========================================================================
  // Boundary with Milestone B11: Submissions Intake
  // =========================================================================

  async submitAssignment(
    input: SubmitAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<{ revisionNumber: number; submittedAt: string }>> {
    if (ctx?.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'Yêu cầu đã bị hủy.' } };
    }

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
        error: { code: eligibility.reason, message: eligibility.message || 'Không thể nộp bài tập.' },
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
        isLate: eligibility.isLate,
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
        isLate: eligibility.isLate,
      };

      existingSub = {
        id: newSubId,
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        submittedAt: nowTime,
        isLate: eligibility.isLate,
        gradingStatus: 'ungraded',
        latestRevisionId: newRevId,
        revisions: [newRev],
      };
      clone.submissions.push(existingSub);
    }

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
      redactedDetails: `Nộp bài tập ${input.assignmentId} (phiên bản ${nextRevNumber})`,
    });

    storageManager.saveDatabase(clone);

    return {
      ok: true,
      data: {
        revisionNumber: nextRevNumber,
        submittedAt: nowTime,
      },
    };
  }
}

export const mockAssignmentsAdapter = new MockAssignmentsAdapter();
