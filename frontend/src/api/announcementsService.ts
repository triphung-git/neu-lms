import { apiClient } from './client';

export interface AnnouncementRow {
  id: number;
  course_id: string;
  course_name: string;
  author_name: string;
  title: string;
  body: string;
  published_at: string;
  is_read: boolean;
  recipients: number;
}

export interface AnnouncementCourseOption {
  id: string;
  name: string;
  status: 'open' | 'archived' | string;
}

export interface AnnouncementPagination {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface AnnouncementFeed {
  items: AnnouncementRow[];
  courses: AnnouncementCourseOption[];
  pagination: AnnouncementPagination;
}

export interface AnnouncementFeedParams {
  course_id?: string;
  unread?: boolean;
  page?: number;
  page_size?: number;
}

export class AnnouncementsService {
  listForStudent(params: AnnouncementFeedParams = {}, signal?: AbortSignal): Promise<AnnouncementFeed> {
    return apiClient.untypedRequest<AnnouncementFeed>('/api/v1/me/course-announcements', {
      method: 'GET', params: { ...params }, signal,
    });
  }

  listForTeacher(params: Pick<AnnouncementFeedParams, 'page' | 'page_size'> = {}, signal?: AbortSignal): Promise<AnnouncementFeed> {
    return apiClient.untypedRequest<AnnouncementFeed>('/api/v1/teacher/course-announcements', {
      method: 'GET', params: { ...params }, signal,
    });
  }

  getStudentUnreadCount(params: { course_id?: string } = {}, signal?: AbortSignal): Promise<{ unread_count: number }> {
    return apiClient.untypedRequest<{ unread_count: number }>('/api/v1/me/course-announcements/unread', {
      method: 'GET', params: { ...params }, signal,
    });
  }

  publish(input: { request_key: string; course_id: string; title: string; body: string }): Promise<{ id: number }> {
    return apiClient.untypedRequest<{ id: number }>('/api/v1/teacher/course-announcements/publish', {
      method: 'POST', body: input,
    });
  }

  markStudentRead(id: number): Promise<void> {
    return apiClient.untypedRequest<void>(`/api/v1/me/course-announcements/${id}/read`, {
      method: 'POST',
    });
  }

  markAllStudentRead(params: { course_id?: string } = {}): Promise<void> {
    return apiClient.untypedRequest<void>('/api/v1/me/course-announcements/read-all', {
      method: 'POST',
      params: { ...params },
    });
  }
}

export const announcementsService = new AnnouncementsService();
