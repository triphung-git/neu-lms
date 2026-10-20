import type {
  SaveGradeDraftInput,
  PublishGradeInput,
  BulkPublishInput,
  StudentGradeViewModel,
  TeacherGradingSheetViewModel,
  CourseGradebookViewModel
} from './gradingDto';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code?: string; message: string } };

export interface GradingPort {
  getGradingSheet(
    submissionId: string,
    teacherId: string,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<TeacherGradingSheetViewModel>>;

  saveDraft(
    input: SaveGradeDraftInput,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<{ revisionId: string }>>;

  publishGrade(
    input: PublishGradeInput,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<{ revisionId: string }>>;

  bulkPublishGrades(
    input: BulkPublishInput,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<{ publishedCount: number }>>;

  getStudentGrade(
    assignmentId: string,
    studentId: string,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<StudentGradeViewModel | null>>;

  getCourseGradebook(
    courseId: string,
    teacherId: string,
    ctx?: { signal?: AbortSignal }
  ): Promise<Result<CourseGradebookViewModel>>;
}
