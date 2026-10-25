import { apiClient, type ApiClient } from './client';
import type { components } from './schema';

export type Course = components['schemas']['Course'];
export type CourseRequest = components['schemas']['CourseRequest'];
export type Chapter = components['schemas']['Chapter'];
export type ChapterRequest = components['schemas']['ChapterRequest'];
export type Lesson = components['schemas']['Lesson'];
export type LessonRequest = components['schemas']['LessonRequest'];
export type PaginatedCourseList = components['schemas']['PaginatedCourseList'];

export interface ListCoursesParams {
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
}

export const coursesService = new CoursesService();
