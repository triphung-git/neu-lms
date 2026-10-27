import { apiClient, type ApiClient } from './client';
import type { components } from './schema';

export type Course = components['schemas']['Course'];
export type CourseRequest = components['schemas']['CourseRequest'];
export type Chapter = components['schemas']['Chapter'];
export type ChapterRequest = components['schemas']['ChapterRequest'];
export type Lesson = components['schemas']['Lesson'];
export type LessonRequest = components['schemas']['LessonRequest'];
export type PaginatedCourseList = components['schemas']['PaginatedCourseList'];
export type CourseSummaryResponse = components['schemas']['CourseSummaryResponse'];
export type CourseSummaryItem = components['schemas']['CourseSummaryItem'];
export type CourseCatalogItem = components['schemas']['CourseCatalogItem'];
export type PaginatedCourseCatalogItemList = components['schemas']['PaginatedCourseCatalogItemList'];
export type StudentEnrollmentRequest = components['schemas']['StudentEnrollmentRequest'];
export type PaginatedStudentEnrollmentRequestList =
  components['schemas']['PaginatedStudentEnrollmentRequestList'];
export type TeacherEnrollmentRequest = components['schemas']['TeacherEnrollmentRequest'];
export type PaginatedTeacherEnrollmentRequestList =
  components['schemas']['PaginatedTeacherEnrollmentRequestList'];
export type CourseMember = components['schemas']['CourseMember'];
export type PaginatedCourseMemberList = components['schemas']['PaginatedCourseMemberList'];
export type AddMemberRequest = components['schemas']['AddMemberRequest'];
export type RejectEnrollmentRequestRequest =
  components['schemas']['RejectEnrollmentRequestRequest'];

export interface ListCoursesParams {
  role?: 'teacher' | 'student';
  search?: string;
  term?: string;
  status?: 'open' | 'archived';
  enrollment_open?: boolean;
  page?: number;
  page_size?: number;
}

export class CoursesService {
  constructor(private readonly client: ApiClient = apiClient) {}

  list(params?: ListCoursesParams): Promise<PaginatedCourseList> {
    return this.client.get('/api/v1/courses', { params });
  }

  getSummary(role?: 'teacher' | 'student'): Promise<CourseSummaryResponse> {
    return this.client.get('/api/v1/courses/summary', {
      params: role ? { role } : undefined,
    });
  }

  get(id: string): Promise<Course> {
    return this.client.untypedRequest<Course>(
      `/api/v1/courses/${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
  }

  create(data: CourseRequest): Promise<Course> {
    return this.client.post('/api/v1/courses', data);
  }

  update(id: string, data: Partial<CourseRequest>): Promise<Course> {
    return this.client.untypedRequest<Course>(
      `/api/v1/courses/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: data },
    );
  }

  archive(id: string): Promise<Course> {
    return this.client.untypedRequest<Course>(
      `/api/v1/courses/${encodeURIComponent(id)}/archive`,
      { method: 'POST' },
    );
  }

  remove(id: string): Promise<void> {
    return this.client.untypedRequest<void>(
      `/api/v1/courses/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  transferTeacher(id: string, teacherId: string): Promise<Course> {
    return this.client.untypedRequest<Course>(
      `/api/v1/admin/courses/${encodeURIComponent(id)}/transfer`,
      { method: 'POST', body: { teacher_id: teacherId } },
    );
  }

  listChapters(courseId: string): Promise<Chapter[]> {
    return this.client.untypedRequest<Chapter[]>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters`,
      { method: 'GET' },
    );
  }

  createChapter(courseId: string, data: ChapterRequest): Promise<Chapter> {
    return this.client.untypedRequest<Chapter>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters`,
      { method: 'POST', body: data },
    );
  }

  updateChapter(courseId: string, chapterId: string, data: Partial<ChapterRequest>): Promise<Chapter> {
    return this.client.untypedRequest<Chapter>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}`,
      { method: 'PATCH', body: data },
    );
  }

  deleteChapter(courseId: string, chapterId: string): Promise<void> {
    return this.client.untypedRequest<void>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}`,
      { method: 'DELETE' },
    );
  }

  reorderChapters(courseId: string, ids: string[]): Promise<Chapter[]> {
    return this.client.untypedRequest<Chapter[]>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/reorder`,
      { method: 'POST', body: { ids } },
    );
  }

  listLessons(courseId: string, chapterId: string): Promise<Lesson[]> {
    return this.client.untypedRequest<Lesson[]>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}/lessons`,
      { method: 'GET' },
    );
  }

  createLesson(courseId: string, chapterId: string, data: LessonRequest): Promise<Lesson> {
    return this.client.untypedRequest<Lesson>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}/lessons`,
      { method: 'POST', body: data },
    );
  }

  updateLesson(
    courseId: string,
    chapterId: string,
    lessonId: string,
    data: Partial<LessonRequest>,
  ): Promise<Lesson> {
    return this.client.untypedRequest<Lesson>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}/lessons/${encodeURIComponent(lessonId)}`,
      { method: 'PATCH', body: data },
    );
  }

  deleteLesson(courseId: string, chapterId: string, lessonId: string): Promise<void> {
    return this.client.untypedRequest<void>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}/lessons/${encodeURIComponent(lessonId)}`,
      { method: 'DELETE' },
    );
  }

  reorderLessons(courseId: string, chapterId: string, ids: string[]): Promise<Lesson[]> {
    return this.client.untypedRequest<Lesson[]>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/chapters/${encodeURIComponent(chapterId)}/lessons/reorder`,
      { method: 'POST', body: { ids } },
    );
  }

  // Catalog
  getCatalog(params?: {
    search?: string;
    term?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedCourseCatalogItemList> {
    return this.client.get('/api/v1/courses/catalog', { params });
  }

  // Student Enrollment Requests
  getMyEnrollmentRequests(params?: {
    status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
    page?: number;
    page_size?: number;
  }): Promise<PaginatedStudentEnrollmentRequestList> {
    return this.client.get('/api/v1/courses/enrollment-requests/my', { params });
  }

  enroll(courseId: string): Promise<StudentEnrollmentRequest> {
    return this.client.untypedRequest<StudentEnrollmentRequest>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/enroll`,
      { method: 'POST' },
    );
  }

  cancelEnrollmentRequest(requestId: string): Promise<StudentEnrollmentRequest> {
    return this.client.untypedRequest<StudentEnrollmentRequest>(
      `/api/v1/courses/enrollment-requests/${encodeURIComponent(requestId)}/cancel`,
      { method: 'POST' },
    );
  }

  // Teacher Enrollment Requests
  getCourseEnrollmentRequests(
    courseId: string,
    params?: {
      search?: string;
      status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
      page?: number;
      page_size?: number;
    },
  ): Promise<PaginatedTeacherEnrollmentRequestList> {
    return this.client.untypedRequest<PaginatedTeacherEnrollmentRequestList>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/enrollment-requests`,
      { method: 'GET', params },
    );
  }

  approveEnrollmentRequest(requestId: string): Promise<TeacherEnrollmentRequest> {
    return this.client.untypedRequest<TeacherEnrollmentRequest>(
      `/api/v1/courses/enrollment-requests/${encodeURIComponent(requestId)}/approve`,
      { method: 'POST' },
    );
  }

  rejectEnrollmentRequest(requestId: string, reason?: string): Promise<TeacherEnrollmentRequest> {
    return this.client.untypedRequest<TeacherEnrollmentRequest>(
      `/api/v1/courses/enrollment-requests/${encodeURIComponent(requestId)}/reject`,
      { method: 'POST', body: { reason: reason ?? '' } },
    );
  }

  // Members
  getCourseMembers(
    courseId: string,
    params?: {
      search?: string;
      status?: 'active' | 'withdrawn';
      page?: number;
      page_size?: number;
    },
  ): Promise<PaginatedCourseMemberList> {
    return this.client.untypedRequest<PaginatedCourseMemberList>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/members`,
      { method: 'GET', params },
    );
  }

  addCourseMember(courseId: string, studentEmail: string): Promise<CourseMember> {
    return this.client.untypedRequest<CourseMember>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/members`,
      { method: 'POST', body: { student_email: studentEmail } },
    );
  }

  withdrawMember(courseId: string, studentId: string): Promise<CourseMember> {
    return this.client.untypedRequest<CourseMember>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/members/${encodeURIComponent(studentId)}/withdraw`,
      { method: 'POST' },
    );
  }

  reEnrollMember(courseId: string, studentId: string): Promise<CourseMember> {
    return this.client.untypedRequest<CourseMember>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/members/${encodeURIComponent(studentId)}/re-enroll`,
      { method: 'POST' },
    );
  }
}

export const coursesService = new CoursesService();
