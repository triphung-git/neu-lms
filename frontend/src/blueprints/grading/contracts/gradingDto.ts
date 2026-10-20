import type { GradeRevision, Submission, Assignment, Course, User } from '../../../shared/kernel/types';

export interface SaveGradeDraftInput {
  submissionId: string;
  score: number;
  rubricScores?: Record<string, number>;
  feedback?: string;
  authorId?: string;
}

export interface PublishGradeInput {
  submissionId: string;
  score: number;
  rubricScores?: Record<string, number>;
  feedback?: string;
  authorId?: string;
}

export interface BulkPublishInput {
  courseId: string;
  assignmentId: string;
  items: Array<{
    submissionId: string;
    score: number;
    rubricScores?: Record<string, number>;
    feedback?: string;
  }>;
}

export interface StudentGradeViewModel {
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  courseCode: string;
  dueAt: string;
  submittedAt?: string;
  isGraded: boolean;
  publishedGrade?: {
    total: number;
    criterionScores: Array<{ criterionId: string; score: number }>;
    feedback: string;
    publishedAt: string;
  } | null;
}

export interface TeacherGradingSheetViewModel {
  submission: Submission;
  assignment: Assignment;
  course: Course;
  student: User | null;
  revisions: GradeRevision[];
  latestDraft: GradeRevision | null;
  latestPublished: GradeRevision | null;
}

export interface CourseGradebookViewModel {
  course: Course;
  assignments: Assignment[];
  rows: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    isWithdrawn: boolean;
    grades: Record<string, { total: number; isPublished: boolean } | null>;
  }>;
}
