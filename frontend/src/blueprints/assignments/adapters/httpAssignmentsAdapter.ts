/**
 * HTTP Adapter for Assignments Domain (B10).
 *
 * Implements AssignmentsPort using real backend REST API contracts
 * via `assignmentsService` and `apiClient`.
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
import {
  assignmentsService,
  type AssignmentsService,
  type AssignmentSummaryItem as RawSummaryItem,
  type AssignmentDetail as RawAssignmentDetail,
} from '../../../api/assignmentsService';
import type { components } from '../../../api/schema';
import { ApiError } from '../../../api/client';

const mimeExtensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'application/zip': 'zip',
};
const extensionMime = (extension: string): string =>
  Object.entries(mimeExtensions).find(([, value]) => value === extension)?.[0] || `application/${extension}`;
const mimeExtension = (mime: string): string => mimeExtensions[mime] || mime.replace(/^.*\//, '');

export class HttpAssignmentsAdapter implements AssignmentsPort {
  constructor(private readonly service: AssignmentsService = assignmentsService) {}

  private mapSummaryItem(item: RawSummaryItem): AssignmentSummaryItem {
    return {
      id: item.id,
      courseId: item.course_id,
      chapterId: item.chapter_id,
      title: item.title,
      status: item.status,
      dueAt: item.due_at,
      allowLate: item.allow_late,
      manuallyClosedAt: item.manually_closed_at,
      totalScore: item.total_score,
      rubricCount: item.rubric_count,
      attachmentCount: item.attachment_count,
      submissionCount: item.submission_count,
      gradedCount: item.graded_count,
      aiGradingOptIn: item.ai_grading_opt_in,
      publishedAt: item.published_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      version: item.version,
    };
  }

  private mapDetail(raw: RawAssignmentDetail): AssignmentDetail {
    const rubricCriteria: RubricCriterionDto[] = (raw.rubric_criteria || []).map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description || '',
      maxScore: Number(c.max_score),
      position: c.position,
    }));

    const attachments: AssignmentAttachmentDto[] = (raw.attachments || []).map((att) => ({
      id: att.file_id,
      filename: att.name,
      sizeBytes: att.size_bytes,
      mimeType: att.mime_type || 'application/octet-stream',
      sha256: att.sha256_hash || undefined,
      downloadUrl: att.download_url,
      previewUrl: att.preview_url ?? undefined,
    }));

    const allowedExts = Array.isArray(raw.file_policy?.allowed_extensions)
      ? (raw.file_policy.allowed_extensions as string[])
      : ['pdf', 'docx', 'zip'];

    const filePolicy: AssignmentFilePolicyDto = {
      allowedMimeTypes: allowedExts.map(extensionMime),
      maxFileSizeBytes: raw.file_policy?.max_file_size_bytes || DEFAULT_ASSIGNMENT_FILE_POLICY.maxFileSizeBytes,
      maxFilesPerSubmission: raw.file_policy?.max_files_per_submission || DEFAULT_ASSIGNMENT_FILE_POLICY.maxFilesPerSubmission,
      previewAllowed: true,
    };

    return {
      id: raw.id,
      courseId: raw.course_id,
      chapterId: raw.chapter_id,
      title: raw.title,
      instructions: raw.instructions,
      status: raw.status,
      dueAt: raw.due_at,
      allowLate: raw.allow_late,
      manuallyClosedAt: raw.manually_closed_at,
      rubricCriteria,
      totalScore: raw.total_score,
      filePolicy,
      attachments,
      aiGradingOptIn: raw.ai_grading_opt_in,
      publishedAt: raw.published_at,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      version: raw.version,
    };
  }

  private handleError(error: unknown): Result<never> {
    if (error instanceof ApiError) {
      return {
        ok: false,
        error: {
          code: String(error.status),
          message: error.message || 'Lỗi xử lý yêu cầu bài tập',
          details: error.details,
        },
      };
    }
    const message = error instanceof Error ? error.message : 'Lỗi không xác định khi gọi máy chủ';
    return {
      ok: false,
      error: {
        message,
        details: error,
      },
    };
  }

  async listTeacherAssignments(
    courseId: string,
    filters?: AssignmentListFilters,
    ctx?: RequestContext
  ): Promise<Result<PaginatedResult<AssignmentSummaryItem>>> {
    try {
      const res = await this.service.listTeacherAssignments(
        courseId,
        {
          status: filters?.status === 'all' ? undefined : filters?.status,
          chapter_id: filters?.chapterId,
          search: filters?.search,
          page: filters?.page,
          page_size: filters?.pageSize,
        },
        { signal: ctx?.signal }
      );

      return {
        ok: true,
        data: {
          items: res.items.map((item) => this.mapSummaryItem(item)),
          pagination: {
            page: res.pagination.page,
            pageSize: res.pagination.page_size,
            totalItems: res.pagination.total_items,
            totalPages: res.pagination.total_pages,
          },
        },
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async getTeacherAssignmentDetail(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    try {
      const raw = await this.service.getTeacherAssignment(courseId, assignmentId, { signal: ctx?.signal });
      return {
        ok: true,
        data: this.mapDetail(raw),
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async createAssignment(
    input: CreateAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    try {
      const rubricCriteria = (input.rubricCriteria || []).map((c, idx) => ({
        id: c.id,
        title: c.title,
        description: c.description || '',
        max_score: String(c.maxScore),
        position: c.position || idx + 1,
      }));

      const raw = await this.service.createAssignment(
        input.courseId,
        {
          title: input.title,
          instructions: input.instructions || '',
          due_at: input.dueAt,
          allow_late: input.allowLate,
          chapter_id: input.chapterId || null,
          ai_grading_opt_in: input.aiGradingOptIn || false,
          publish_immediately: input.publishImmediately || false,
          rubric_criteria: rubricCriteria,
          attachment_file_ids: input.attachmentFileIds || [],
          file_policy: input.filePolicy
            ? {
                max_files_per_submission: input.filePolicy.maxFilesPerSubmission ?? DEFAULT_ASSIGNMENT_FILE_POLICY.maxFilesPerSubmission,
                max_file_size_bytes: input.filePolicy.maxFileSizeBytes ?? DEFAULT_ASSIGNMENT_FILE_POLICY.maxFileSizeBytes,
                allowed_extensions: (input.filePolicy.allowedMimeTypes || []).map((m) =>
                  mimeExtension(m)
                ),
              }
            : undefined,
        },
        {
          idempotencyKey: ctx?.idempotencyKey || input.idempotencyKey,
          signal: ctx?.signal,
        }
      );

      return {
        ok: true,
        data: this.mapDetail(raw),
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async updateAssignment(
    courseId: string,
    assignmentId: string,
    input: UpdateAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    try {
      const rubricCriteria = input.rubricCriteria
        ? input.rubricCriteria.map((c, idx) => ({
            id: c.id,
            title: c.title,
            description: c.description || '',
            max_score: String(c.maxScore),
            position: c.position || idx + 1,
          }))
        : undefined;

      const raw = await this.service.updateAssignment(
        courseId,
        assignmentId,
        {
          title: input.title,
          instructions: input.instructions,
          chapter_id: input.chapterId,
          due_at: input.dueAt,
          allow_late: input.allowLate,
          ai_grading_opt_in: input.aiGradingOptIn,
          rubric_criteria: rubricCriteria,
          attachment_file_ids: input.attachmentFileIds,
          expected_version: input.expectedVersion,
          file_policy: input.filePolicy
            ? {
                max_files_per_submission: input.filePolicy.maxFilesPerSubmission ?? DEFAULT_ASSIGNMENT_FILE_POLICY.maxFilesPerSubmission,
                max_file_size_bytes: input.filePolicy.maxFileSizeBytes ?? DEFAULT_ASSIGNMENT_FILE_POLICY.maxFileSizeBytes,
                allowed_extensions: (input.filePolicy.allowedMimeTypes || []).map((m) =>
                  mimeExtension(m)
                ),
              }
            : undefined,
        },
        {
          ifMatch: input.expectedVersion,
          idempotencyKey: ctx?.idempotencyKey,
          signal: ctx?.signal,
        }
      );

      return {
        ok: true,
        data: this.mapDetail(raw),
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async publishAssignment(
    courseId: string,
    input: PublishAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    try {
      const raw = await this.service.publishAssignment(
        courseId,
        input.assignmentId,
        {},
        {
          idempotencyKey: ctx?.idempotencyKey,
          signal: ctx?.signal,
        }
      );

      return {
        ok: true,
        data: this.mapDetail(raw),
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async closeAssignment(
    courseId: string,
    input: CloseAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>> {
    try {
      const raw =
        input.closeType === 'reopen'
          ? await this.service.reopenAssignment(
              courseId,
              input.assignmentId,
              {
                close_type: 'reopen',
                reason: input.reason || '',
                target_type: input.reopenStudentIds?.length ? 'student' : 'all',
                reopen_until: input.reopenUntil || undefined,
                reopen_student_ids: input.reopenStudentIds,
                scope: 'all_actions',
              },
              { idempotencyKey: ctx?.idempotencyKey, signal: ctx?.signal }
            )
          : await this.service.closeAssignment(
              courseId,
              input.assignmentId,
              {
                close_type: 'manual_close',
                reason: input.reason || '',
                target_type: 'all',
                scope: 'all_actions',
              },
              { idempotencyKey: ctx?.idempotencyKey, signal: ctx?.signal }
            );

      return {
        ok: true,
        data: this.mapDetail(raw),
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async previewAssignmentAsStudent(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>> {
    try {
      const previewRes = await this.service.previewAssignment(courseId, assignmentId, {
        signal: ctx?.signal,
      });
      const preview = previewRes.assignment;

      const allowedExts = Array.isArray(preview.file_policy?.allowed_extensions)
        ? (preview.file_policy.allowed_extensions as string[])
        : ['pdf', 'docx', 'zip'];

      const filePolicy: AssignmentFilePolicyDto = {
        allowedMimeTypes: allowedExts.map(extensionMime),
        maxFileSizeBytes: preview.file_policy?.max_file_size_bytes || DEFAULT_ASSIGNMENT_FILE_POLICY.maxFileSizeBytes,
        maxFilesPerSubmission: preview.file_policy?.max_files_per_submission || DEFAULT_ASSIGNMENT_FILE_POLICY.maxFilesPerSubmission,
        previewAllowed: true,
      };

      const view: StudentAssignmentView = {
        assignment: {
          id: preview.id,
          courseId: preview.course_id,
          courseTitle: 'Môn học',
          chapterTitle: null,
          title: preview.title,
          instructions: preview.instructions,
          dueAt: preview.due_at,
          allowLate: preview.allow_late,
          manuallyClosedAt: preview.manually_closed_at || null,
          rubricCriteria: (preview.rubric_criteria || []).map((c) => ({
            id: c.id,
            title: c.title,
            description: c.description || '',
            maxScore: Number(c.max_score),
            position: c.position,
          })),
          totalScore: preview.total_score,
          filePolicy,
          attachments: (preview.attachments || []).map((att) => ({
            id: att.file_id,
            filename: att.name,
            sizeBytes: att.size_bytes,
            mimeType: att.mime_type || 'application/octet-stream',
            downloadUrl: att.download_url,
            previewUrl: att.preview_url ?? undefined,
          })),
          publishedAt: preview.published_at || '',
        },
        eligibility: {
          canSubmit: preview.is_submission_window_open,
          isLate: false,
          isClosed: !preview.is_submission_window_open,
          serverTime: new Date().toISOString(),
        },
        submission: null,
        publishedGrade: null,
      };

      return {
        ok: true,
        data: view,
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  private mapStudentAssignmentView(
    raw: RawAssignmentDetail,
    eligibilityRaw: components['schemas']['StudentAssignmentEligibility']
  ): StudentAssignmentView {
    const detail = this.mapDetail(raw);
    const eligibility: StudentAssignmentEligibility = {
      canSubmit: eligibilityRaw.can_submit,
      isLate: eligibilityRaw.is_late,
      isClosed: !eligibilityRaw.can_submit || Boolean(eligibilityRaw.manually_closed),
      reason: (eligibilityRaw.reason as any) || undefined,
      message: eligibilityRaw.reason || undefined,
      serverTime: eligibilityRaw.server_time,
    };

    return {
      assignment: {
        id: detail.id,
        courseId: detail.courseId,
        courseTitle: 'Môn học',
        chapterTitle: null,
        title: detail.title,
        instructions: detail.instructions,
        dueAt: detail.dueAt,
        allowLate: detail.allowLate,
        manuallyClosedAt: detail.manuallyClosedAt,
        rubricCriteria: detail.rubricCriteria,
        totalScore: detail.totalScore,
        filePolicy: detail.filePolicy,
        attachments: detail.attachments,
        publishedAt: detail.publishedAt || '',
      },
      eligibility,
      submission: null,
      publishedGrade: null,
    };
  }

  async listStudentAssignments(
    courseId: string,
    filters?: AssignmentListFilters,
    ctx?: RequestContext
  ): Promise<Result<PaginatedResult<AssignmentSummaryItem>>> {
    try {
      const res = await this.service.listPublishedAssignments(
        courseId,
        {
          chapter_id: filters?.chapterId,
          search: filters?.search,
          page: filters?.page,
          page_size: filters?.pageSize,
        },
        { signal: ctx?.signal }
      );

      return {
        ok: true,
        data: {
          items: res.items.map((item) => this.mapSummaryItem(item)),
          pagination: {
            page: res.pagination.page,
            pageSize: res.pagination.page_size,
            totalItems: res.pagination.total_items,
            totalPages: res.pagination.total_pages,
          },
        },
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async getStudentAssignment(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>> {
    try {
      const [raw, eligibilityRaw] = await Promise.all([
        this.service.getAssignment(courseId, assignmentId, { signal: ctx?.signal }),
        this.service.getStudentEligibility(courseId, assignmentId, { signal: ctx?.signal }),
      ]);

      return {
        ok: true,
        data: this.mapStudentAssignmentView(raw, eligibilityRaw),
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async getStudentAssignmentDirect(
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>> {
    try {
      const [raw, eligibilityRaw] = await Promise.all([
        this.service.getAssignmentDirect(assignmentId, { signal: ctx?.signal }),
        this.service.getStudentEligibilityDirect(assignmentId, { signal: ctx?.signal }),
      ]);

      return {
        ok: true,
        data: this.mapStudentAssignmentView(raw, eligibilityRaw),
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async checkStudentEligibility(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentEligibility>> {
    try {
      const eligibility = await this.service.getStudentEligibility(courseId, assignmentId, {
        signal: ctx?.signal,
      });

      return {
        ok: true,
        data: {
          canSubmit: eligibility.can_submit,
          isLate: eligibility.is_late,
          isClosed: !eligibility.can_submit || Boolean(eligibility.manually_closed),
          reason: (eligibility.reason as any) || undefined,
          message: eligibility.reason || undefined,
          serverTime: eligibility.server_time,
        },
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async getStudentAssignmentDetail(
    assignmentId: string,
    _studentId?: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentDetailViewModel>> {
    const res = await this.getStudentAssignmentDirect(assignmentId, ctx);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    const { assignment, eligibility } = res.data;
    return {
      ok: true,
      data: {
        assignment: {
          id: assignment.id,
          courseId: assignment.courseId,
          title: assignment.title,
          instructions: assignment.instructions,
          dueAt: assignment.dueAt,
          allowLate: assignment.allowLate,
          status: 'published',
          maxScore: assignment.totalScore,
          passingScore: 5,
          weightPercent: 10,
          rubricCriteria: assignment.rubricCriteria.map((c) => ({
            id: c.id,
            title: c.title,
            maxScore: c.maxScore,
            description: c.description,
          })),
          attachments: assignment.attachments.map((a) => ({
            name: a.filename,
            sizeBytes: a.sizeBytes,
            assetId: a.id,
          })),
        } as any,
        isEnrolled: true,
        submission: null,
        publishedGrade: null,
        canSubmit: eligibility.canSubmit,
        isLate: eligibility.isLate,
        rejectionReason: eligibility.message,
      },
    };
  }

  async submitAssignment(
    _input: SubmitAssignmentInput,
    _ctx?: RequestContext
  ): Promise<Result<{ revisionNumber: number; submittedAt: string }>> {
    return {
      ok: false,
      error: {
        code: 'MILESTONE_B11_PENDING',
        message: 'Quy trình nộp bài chính thức sẽ được kích hoạt tại Milestone B11.',
      },
    };
  }
}

export const httpAssignmentsAdapter = new HttpAssignmentsAdapter();
