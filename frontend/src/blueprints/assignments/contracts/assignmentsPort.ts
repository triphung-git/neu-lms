import type { SubmitAssignmentInput, StudentAssignmentDetailViewModel } from './assignmentsDto';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code?: string; message: string } };

export interface AssignmentsPort {
  getStudentAssignmentDetail(
    assignmentId: string,
    studentId: string,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<StudentAssignmentDetailViewModel>>;

  submitAssignment(
    input: SubmitAssignmentInput,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<{ revisionNumber: number; submittedAt: string }>>;
}
