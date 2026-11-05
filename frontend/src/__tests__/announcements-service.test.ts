import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { announcementsService } from '../api/announcementsService';

afterEach(() => vi.restoreAllMocks());

describe('AnnouncementsService - server backed notices', () => {
  it('requests the student feed using server-side course and unread filters', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue({
      items: [],
      courses: [],
      pagination: { page: 1, page_size: 20, total_items: 0, total_pages: 0, has_next: false, has_previous: false },
    });
    const controller = new AbortController();

    await announcementsService.listForStudent({ course_id: 'course-1', unread: true, page: 2, page_size: 20 }, controller.signal);

    expect(request).toHaveBeenCalledWith('/api/v1/me/course-announcements', {
      method: 'GET',
      params: { course_id: 'course-1', unread: true, page: 2, page_size: 20 },
      signal: controller.signal,
    });
  });

  it('loads unread counts scoped to the selected course', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue({ unread_count: 3 });
    await expect(announcementsService.getStudentUnreadCount({ course_id: 'course-1' })).resolves.toEqual({ unread_count: 3 });
    expect(request).toHaveBeenCalledWith('/api/v1/me/course-announcements/unread', {
      method: 'GET',
      params: { course_id: 'course-1' },
      signal: undefined,
    });
  });

  it('publishes a server announcement with an idempotency request key', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue({ id: 42 });
    const payload = {
      request_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      course_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Thông báo lịch học',
      body: 'Buổi học chuyển sang phòng mới.',
    };

    await expect(announcementsService.publish(payload)).resolves.toEqual({ id: 42 });
    expect(request).toHaveBeenCalledWith('/api/v1/teacher/course-announcements/publish', {
      method: 'POST',
      body: payload,
    });
  });

  it('uses the dedicated server endpoints to mark one or all student notices as read', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue(null);

    await announcementsService.markStudentRead(42);
    await announcementsService.markAllStudentRead({ course_id: 'course-1' });

    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/me/course-announcements/42/read', { method: 'POST' });
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/me/course-announcements/read-all', {
      method: 'POST',
      params: { course_id: 'course-1' },
    });
  });
});
