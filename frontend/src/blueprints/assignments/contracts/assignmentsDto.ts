import type { Assignment, Submission, GradeRevision } from '../../../shared/kernel/types';

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
