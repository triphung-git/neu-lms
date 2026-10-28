/**
 * Assignments Domain Data Transfer Objects (DTOs) & Models.
 *
 * Defines business contracts for Assignment Management (B10),
 * separating domain DTOs from demo kernel types and establishing
 * server-authoritative contracts for teacher and student operations.
 *
 * Note: Submissions intake belongs to Milestone B11;
 * Grading and gradebook belong to Milestone B12.
 */

import type { Assignment, Submission, GradeRevision } from '../../../shared/kernel/types';

// =============================================================================
// Core Value Objects & Enums
// =============================================================================

export type AssignmentStatus = 'draft' | 'published' | 'closed' | 'archived';

export interface RubricCriterionDto {
  id: string;
  title: string;
  description: string;
  maxScore: number;
  position?: number;
}

export interface AssignmentAttachmentDto {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  sha256?: string;
  downloadUrl?: string;
  previewUrl?: string;
}

export interface AssignmentFilePolicyDto {
  allowedMimeTypes: string[];
  maxFileSizeBytes: number;
  maxFilesPerSubmission: number;
  previewAllowed: boolean;
}

export const DEFAULT_ASSIGNMENT_FILE_POLICY: AssignmentFilePolicyDto = {
  allowedMimeTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ],
  maxFileSizeBytes: 25 * 1024 * 1024, // 25 MiB
  maxFilesPerSubmission: 1,
  previewAllowed: true,
};

// =============================================================================
// Pagination & Common Error Envelopes
// =============================================================================

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface AssignmentErrorDetails {
  code?: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  details?: unknown;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AssignmentErrorDetails };

export interface RequestContext {
  signal?: AbortSignal;
  idempotencyKey?: string;
}

// =============================================================================
// Teacher View & Summary DTOs (B10)
// =============================================================================

export interface AssignmentSummaryItem {
  id: string;
  courseId: string;
  chapterId?: string | null;
  title: string;
  status: AssignmentStatus;
  dueAt: string; // ISO Datetime
  allowLate: boolean;
  manuallyClosedAt?: string | null;
  totalScore: number;
  rubricCount: number;
  attachmentCount: number;
  submissionCount: number;
  gradedCount: number;
  aiGradingOptIn: boolean;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AssignmentDetail {
  id: string;
  courseId: string;
  chapterId?: string | null;
  title: string;
  instructions: string;
  status: AssignmentStatus;
  dueAt: string;
  allowLate: boolean;
  manuallyClosedAt?: string | null;
  rubricCriteria: RubricCriterionDto[];
  totalScore: number;
  filePolicy: AssignmentFilePolicyDto;
  attachments: AssignmentAttachmentDto[];
  aiGradingOptIn: boolean;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AssignmentListFilters {
  status?: AssignmentStatus | 'all';
  chapterId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

// =============================================================================
// Teacher Mutation Inputs (B10)
// =============================================================================

export interface CreateAssignmentInput {
  courseId: string;
  chapterId?: string | null;
  title: string;
  instructions: string;
  dueAt: string;
  allowLate: boolean;
  rubricCriteria: Array<{
    id?: string;
    title: string;
    description: string;
    maxScore: number;
    position?: number;
  }>;
  filePolicy?: Partial<AssignmentFilePolicyDto>;
  attachmentFileIds?: string[];
  publishImmediately?: boolean;
  aiGradingOptIn?: boolean;
  idempotencyKey?: string;
}

export interface UpdateAssignmentInput {
  // Pre-publish editable fields
  title?: string;
  instructions?: string;
  chapterId?: string | null;
  rubricCriteria?: RubricCriterionDto[]; // Immutable once published!
  attachmentFileIds?: string[];

  // Post-publish allowed adjustments
  dueAt?: string;
  allowLate?: boolean;
  filePolicy?: Partial<AssignmentFilePolicyDto>; // Versioned future policy
  aiGradingOptIn?: boolean;

  // Optimistic concurrency
  expectedVersion?: number;
  ifMatchUpdatedAt?: string;
}

export interface PublishAssignmentInput {
  assignmentId: string;
  ifMatchUpdatedAt?: string;
  expectedVersion?: number;
}

export interface CloseAssignmentInput {
  assignmentId: string;
  closeType: 'manual_close' | 'reopen';
  reopenUntil?: string; // For reopen exception window
  reopenStudentIds?: string[]; // Target students or all enrolled
  reason?: string; // Audit log reason
}

// =============================================================================
// Student View & Eligibility Contracts (B10 Server-Authoritative)
// =============================================================================

export type SubmissionIneligibilityReason =
  | 'COURSE_ARCHIVED'
  | 'NOT_ENROLLED'
  | 'ASSIGNMENT_NOT_PUBLISHED'
  | 'DEADLINE_PASSED'
  | 'MANUALLY_CLOSED'
  | 'UNKNOWN';

export interface StudentAssignmentEligibility {
  canSubmit: boolean;
  isLate: boolean;
  isClosed: boolean;
  reason?: SubmissionIneligibilityReason;
  message?: string;
  serverTime: string; // Server-authoritative time, never trust client clock
}

export interface StudentAssignmentView {
  assignment: {
    id: string;
    courseId: string;
    courseTitle: string;
    chapterTitle?: string | null;
    title: string;
    instructions: string;
    dueAt: string;
    allowLate: boolean;
    manuallyClosedAt?: string | null;
    rubricCriteria: RubricCriterionDto[];
    totalScore: number;
    filePolicy: AssignmentFilePolicyDto;
    attachments: AssignmentAttachmentDto[];
    publishedAt: string;
  };
  eligibility: StudentAssignmentEligibility;
  // Boundary with Milestone B11: Student's existing submission status
  submission?: {
    id: string;
    status: string;
    submittedAt: string;
    revisionCount: number;
    latestRevision?: {
      id: string;
      revisionNumber: number;
      filename: string;
      sizeBytes: number;
      submittedAt: string;
      isLate: boolean;
    };
  } | null;
  // Boundary with Milestone B12: Published grade
  publishedGrade?: {
    score: number;
    totalScore: number;
    feedback?: string;
    publishedAt: string;
    revisionNumber: number;
  } | null;
}

// =============================================================================
// Legacy Transition Types (Preserved for backwards compatibility)
// =============================================================================

export interface SubmitAssignmentInput {
  assignmentId: string;
  studentId: string;
  file: {
    filename: string;
    size: number;
    url?: string;
  };
}

export interface StudentAssignmentDetailViewModel {
  assignment: Assignment;
  isEnrolled: boolean;
  submission: Submission | null;
  publishedGrade: GradeRevision | null;
  canSubmit: boolean;
  isLate: boolean;
  rejectionReason?: string;
}
