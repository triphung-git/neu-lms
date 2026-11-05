import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { announcementsService } from '../api/announcementsService';
import { coursesService } from '../api/coursesService';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { StudentAnnouncementsPage } from '../blueprints/announcements';
import { TeacherAnnouncementsPage } from '../blueprints/announcements';

vi.mock('../blueprints/announcements/pages/GradeNotices', () => ({
  GradeNotices: () => null,
}));

const course = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'WEB101',
  name: 'Lập trình Web',
  term: 'HK1-2026',
  description: '',
  teacher: '33333333-3333-4333-8333-333333333333',
  teacher_name: 'Giảng viên',
  status: 'open',
  enrollment_open: true,
  archived_at: null,
  active_member_count: 2,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const feed = {
  items: [{
    id: 7,
    course_id: course.id,
    course_name: course.name,
    author_name: 'Nguyễn Văn A',
    title: 'Lịch kiểm tra giữa kỳ',
    body: 'Kiểm tra vào tuần sau.',
    published_at: '2026-11-02T09:00:00Z',
    is_read: false,
    recipients: 2,
  }],
  courses: [{ id: course.id, name: course.name, status: 'open' as const }],
  pagination: {
    page: 1,
    page_size: 20,
    total_items: 1,
    total_pages: 1,
    has_next: false,
    has_previous: false,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Announcement pages - active API-backed routes', () => {
  it('renders the student feed and marks all read only for the selected course', async () => {
    vi.spyOn(announcementsService, 'listForStudent').mockResolvedValue(feed);
    vi.spyOn(announcementsService, 'getStudentUnreadCount').mockResolvedValue({ unread_count: 1 });
    const markAll = vi.spyOn(announcementsService, 'markAllStudentRead').mockResolvedValue();

    render(
      <MemoryRouter initialEntries={[`/sv/thong-bao?mon=${course.id}`]}>
        <StudentAnnouncementsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Lịch kiểm tra giữa kỳ')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thông báo từ giảng viên' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Đánh dấu tất cả đã đọc/i }));

    await waitFor(() => expect(markAll).toHaveBeenCalledWith({ course_id: course.id }));
  });

  it('renders the teacher announcement composer from live courses and notice history', async () => {
    vi.spyOn(coursesService, 'list').mockResolvedValue({
      items: [course],
      pagination: {
        page: 1,
        page_size: 100,
        total_items: 1,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    } as Awaited<ReturnType<typeof coursesService.list>>);
    vi.spyOn(announcementsService, 'listForTeacher').mockResolvedValue({
      ...feed,
      items: [],
      pagination: { ...feed.pagination, total_items: 0 },
    });

    render(
      <NotificationProvider>
        <MemoryRouter initialEntries={['/gv/thong-bao']}>
          <TeacherAnnouncementsPage />
        </MemoryRouter>
      </NotificationProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Thông báo môn học & Bản tin lớp' })).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', {
        name: /Chọn lớp học phần tiếp nhận/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Đăng thông báo \(2 sinh viên\)/i })).toBeEnabled();
    expect(screen.getByText(/Email chưa được gửi từ chức năng này/i)).toBeInTheDocument();
  });
});
