/**
 * Assignments Domain Port Interface.
 *
 * Defines the Hexagonal Architecture Port for the Assignments module (B10).
 * Decouples UI callers from backend transport (REST API vs Mock Adapter).
 *
 * All operations return a strongly-typed Result<T> envelope and support
 * standard request context (AbortSignal cancellation, Idempotency keys).
 */

import type {
  Result,
  AssignmentErrorDetails,
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
} from './assignmentsDto';

export type { Result, AssignmentErrorDetails, RequestContext };

export interface AssignmentsPort {
  // =========================================================================
  // Teacher Operations (B10)
  // =========================================================================

  /**
   * List assignments for a course with pagination and status/chapter filters.
   */
  listTeacherAssignments(
    courseId: string,
    filters?: AssignmentListFilters,
    ctx?: RequestContext
  ): Promise<Result<PaginatedResult<AssignmentSummaryItem>>>;

  /**
   * Retrieve full details of an assignment for editing or inspection.
   */
  getTeacherAssignmentDetail(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>>;

  /**
   * Create a new draft assignment with rubric and file policy settings.
   */
  createAssignment(
    input: CreateAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>>;

  /**
   * Update an existing assignment.
   * If draft: statement, rubric, and attachments can be modified.
   * If published: only deadline, allowLate, future file policy, and AI opt-in can be modified.
   * Statement and rubric are frozen after publication.
   */
  updateAssignment(
    courseId: string,
    assignmentId: string,
    input: UpdateAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>>;

  /**
   * Publish an assignment, freezing statement and rubric criteria into immutable snapshots.
   */
  publishAssignment(
    courseId: string,
    input: PublishAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>>;

  /**
   * Close or reopen an assignment.
   * Manual close stops submission intake immediately.
   * Reopen grants an audited exception window for specific or all students.
   */
  closeAssignment(
    courseId: string,
    input: CloseAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<AssignmentDetail>>;

  /**
   * Preview an assignment as student would view it.
   */
  previewAssignmentAsStudent(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>>;

  // =========================================================================
  // Student Operations (B10 - Server-Authoritative)
  // =========================================================================

  /**
   * List published assignments for enrolled students in a course.
   */
  listStudentAssignments(
    courseId: string,
    filters?: AssignmentListFilters,
    ctx?: RequestContext
  ): Promise<Result<PaginatedResult<AssignmentSummaryItem>>>;

  /**
   * Retrieve assignment details for a student.
   * Server resolves identity from session cookie; client cannot spoof studentId.
   */
  getStudentAssignment(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>>;

  /**
   * Retrieve assignment details directly by assignmentId when courseId is not in route.
   */
  getStudentAssignmentDirect(
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentView>>;

  /**
   * Check submission eligibility against server clock and course/assignment policies.
   */
  checkStudentEligibility(
    courseId: string,
    assignmentId: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentEligibility>>;

  /**
   * Overloaded student assignment detail for backwards compatibility with existing callers.
   */
  getStudentAssignmentDetail(
    assignmentId: string,
    studentId?: string,
    ctx?: RequestContext
  ): Promise<Result<StudentAssignmentDetailViewModel>>;

  // =========================================================================
  // Boundary with Milestone B11: Submissions Intake
  // Note: Implementation in B10 mock is placeholder; real submission backend is B11.
  // =========================================================================

  submitAssignment(
    input: SubmitAssignmentInput,
    ctx?: RequestContext
  ): Promise<Result<{ revisionNumber: number; submittedAt: string }>>;
}
