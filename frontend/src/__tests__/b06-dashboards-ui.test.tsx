import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeacherDashboardPage } from '../blueprints/dashboards/pages/TeacherDashboardPage';
import { StudentDashboardPage } from '../blueprints/dashboards/pages/StudentDashboardPage';
import { coursesService, type CourseSummaryResponse } from '../api/coursesService';
import { apiClient } from '../api/client';

vi.mock('../app/providers/SessionContext', () => ({
  useSession: () => ({
    currentUser: {
      id: '0a0a0a0a-1111-4111-8111-000000000002',
      email: 'teacher@neu.edu.vn',
      fullName: 'Giảng viên Một',
    },
    activeRole: 'teacher',
  }),
}));

const mockTeacherSummary: CourseSummaryResponse = {
  role: 'teacher',
  total_courses: 2,
  open_courses: 2,
  archived_courses: 0,
  enrollment_open_courses: 1,
  total_memberships: 15,
  distinct_students: 12,
  total_chapters: 4,
  total_lessons: 10,
  pending_submissions: 3,
  pending_assignments: [{
    assignment_id: '00000000-0000-4000-8000-000000000051',
    title: 'Bài thực hành cần chấm',
    course_name: 'Môn kiểm thử',
    waiting: 3,
    oldest: '2026-11-01T01:00:00Z',
  }],
  scanning_materials: 2,
  problem_materials: 1,
  pending_ai_drafts: 3,
  upcoming_deadlines: 2,
  recent_courses: [
    {
      id: '0a0a0a0a-1111-4111-8111-000000000001',
      code: 'CS101',
      name: 'Lập trình Cơ bản',
      term: 'HK1-2026',
      status: 'open',
      enrollment_open: true,
      active_member_count: 12,
      teacher_name: 'TS. Nguyễn Văn A',
      chapter_count: 2,
      lesson_count: 6,
      created_at: '2026-10-25T00:00:00Z',
      updated_at: '2026-10-25T00:00:00Z',
    },
  ],
  unavailable_metrics: [
    'upcoming_deadlines',
    'pending_ai_drafts',
  ],
};

const mockStudentSummary: CourseSummaryResponse = {
  role: 'student',
  total_enrolled_courses: 1,
  open_enrolled_courses: 1,
  archived_enrolled_courses: 0,
  withdrawn_courses: 0,
  total_chapters: 2,
  total_lessons: 6,
  recent_grades: null,
  recent_announcements: null,
  upcoming_deadlines: null,
  recent_courses: [
    {
      id: '0a0a0a0a-1111-4111-8111-000000000001',
      code: 'CS101',
      name: 'Lập trình Cơ bản',
      term: 'HK1-2026',
      status: 'open',
      enrollment_open: true,
      active_member_count: 12,
      teacher_name: 'TS. Nguyễn Văn A',
      chapter_count: 2,
      lesson_count: 6,
      created_at: '2026-10-25T00:00:00Z',
      updated_at: '2026-10-25T00:00:00Z',
    },
  ],
  unavailable_metrics: [
    'recent_grades',
    'recent_announcements',
    'upcoming_deadlines',
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TeacherDashboardPage API integration', () => {
  it('renders teacher summary metrics and real teaching courses from API', async () => {
    const getSummarySpy = vi
      .spyOn(coursesService, 'getSummary')
      .mockResolvedValue(mockTeacherSummary);

    render(
      <MemoryRouter>
        <TeacherDashboardPage />
      </MemoryRouter>,
    );

        const pendingLink = await screen.findByRole('link', {
      name: 'Bài thực hành cần chấm',
    });

    expect(pendingLink).toHaveAttribute(
      'href',
      '/gv/bai-tap/00000000-0000-4000-8000-000000000051/bai-nop',
    );

    // Verifies service call with role 'teacher'
    expect(getSummarySpy).toHaveBeenCalledWith('teacher');
    const materialCard = await screen.findByRole('region', {
      name: 'Học liệu & An toàn',
    });

    const scanningLabel = within(materialCard).getByText('Đang quét');
    const blockedLabel = within(materialCard).getByText('Bị chặn sau quét');

    expect(scanningLabel.nextElementSibling).toHaveTextContent('2');
    expect(blockedLabel.nextElementSibling).toHaveTextContent('1');
    const label = await screen.findByText('Bài nộp chờ công bố điểm');
    const card = label.closest('.stat-metric-card');
    expect(card).toBeInTheDocument();
    expect(await within(card as HTMLElement).findByText('3')).toBeInTheDocument();

    // Môn học phụ trách
    expect(await screen.findByText('Lập trình Cơ bản')).toBeInTheDocument();
    expect(screen.getByText('CS101')).toBeInTheDocument();
    expect(screen.getByText('12 sinh viên')).toBeInTheDocument();
    expect(screen.getByText('6 bài học')).toBeInTheDocument();

    // Metric numbers
    expect(screen.getByText('12')).toBeInTheDocument(); // distinct_students
    expect(screen.getByText('10')).toBeInTheDocument(); // total_lessons
    expect(screen.getByText('15 lượt ghi danh hoạt động')).toBeInTheDocument();

    // Unavailable indicator for pending submissions
    expect(screen.getByRole('link', { name: 'Xem và duyệt bản nháp →' })).toHaveAttribute('href', '/gv/ban-nhap-ai');
    expect(screen.getByText('3 bản nháp chờ duyệt trong các môn đang mở.')).toBeInTheDocument();
  });

  it('displays empty state when teacher has no courses', async () => {
    vi.spyOn(coursesService, 'getSummary').mockResolvedValue({
      ...mockTeacherSummary,
      open_courses: 0,
      distinct_students: 0,
      total_memberships: 0,
      total_chapters: 0,
      total_lessons: 0,
      recent_courses: [],
    });

    render(
      <MemoryRouter>
        <TeacherDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Bạn chưa phụ trách môn học nào trong học kỳ này.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Khởi tạo môn học đầu tiên' })).toBeInTheDocument();
  });

  it('renders error banner with retry option when API fails and retries successfully', async () => {
    const getSummarySpy = vi
      .spyOn(coursesService, 'getSummary')
      .mockRejectedValueOnce(new Error('Máy chủ gián đoạn kết nối'))
      .mockResolvedValueOnce(mockTeacherSummary);

    render(
      <MemoryRouter>
        <TeacherDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Máy chủ gián đoạn kết nối'),
    ).toBeInTheDocument();
    // Does not misrepresent API failure as empty courses
    expect(
      screen.queryByText('Bạn chưa phụ trách môn học nào trong học kỳ này.'),
    ).not.toBeInTheDocument();

    // Click retry
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Lập trình Cơ bản')).toBeInTheDocument();
    expect(getSummarySpy).toHaveBeenCalledTimes(2);
  });

  it('ignores older responses after unmount', async () => {
    let resolvePromise!: (val: CourseSummaryResponse) => void;
    const slowPromise = new Promise<CourseSummaryResponse>((resolve) => {
      resolvePromise = resolve;
    });

    vi.spyOn(coursesService, 'getSummary').mockReturnValue(slowPromise);

    const { unmount } = render(
      <MemoryRouter>
        <TeacherDashboardPage />
      </MemoryRouter>,
    );

    unmount();

    // Resolving after unmount should not throw or cause React warnings
    await act(async () => {
      resolvePromise(mockTeacherSummary);
    });
  });
});

describe('StudentDashboardPage API integration', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'untypedRequest').mockImplementation(
      async <T,>(endpoint: string): Promise<T> => {
        const courseId = '0a0a0a0a-1111-4111-8111-000000000001';

        if (endpoint === '/api/v1/me/course-announcements') {
          return {
            items: [{
              id: 25,
              course_id: courseId,
              course_name: 'Lập trình Cơ bản',
              title: 'Đổi phòng học tuần tới',
              published_at: '2026-11-02T01:00:00Z',
              is_read: false,
            }],
          } as T;
        }

        if (endpoint === '/api/v1/me/grade-notices') {
          return {
            items: [{
              id: 31,
              course_id: courseId,
              course_name: 'Lập trình Cơ bản',
              assignment_id: '00000000-0000-4000-8000-000000000031',
              title: 'Bài thực hành vòng lặp',
              revision: 2,
              score: '8.75',
              published_at: '2026-11-02T02:00:00Z',
            }],
            pagination: { total_items: 7 },
          } as T;
        }

        if (endpoint === '/api/v1/me/upcoming-assignments') {
          return {
            total: 1,
            items: [{
              id: '00000000-0000-4000-8000-000000000041',
              course_id: courseId,
              course_name: 'Lập trình Cơ bản',
              title: 'Bài tập mảng một chiều',
              deadline: '2026-11-05T10:00:00Z',
            }],
          } as T;
        }

        throw new Error(`Test chưa cấu hình API: ${endpoint}`);
      },
    );
  });
  it('renders student summary metrics and real enrolled courses from API', async () => {
    const getSummarySpy = vi
      .spyOn(coursesService, 'getSummary')
      .mockResolvedValue(mockStudentSummary);

    render(
      <MemoryRouter>
        <StudentDashboardPage />
      </MemoryRouter>,
    );

    expect(getSummarySpy).toHaveBeenCalledWith('student');

    const coursesSection = await screen.findByRole('region', {
      name: /Môn học đang theo học/i,
    });

    const courseList = within(coursesSection);
    expect(await courseList.findByText('Lập trình Cơ bản')).toBeInTheDocument();
    expect(courseList.getByText('CS101')).toBeInTheDocument();
    expect(courseList.getByText(/TS\. Nguyễn Văn A/)).toBeInTheDocument();
    expect(screen.getByText(/6 bài học/)).toBeInTheDocument();

    // Unavailable badges for future modules (Assignments, Grades, Announcements)
    const noticeLink = await screen.findByRole('link', {
      name: 'Đổi phòng học tuần tới',
    });

    const gradeLink = await screen.findByRole('link', {
      name: 'Bài thực hành vòng lặp',
    });

    expect(gradeLink).toHaveAttribute(
      'href',
      '/sv/mon-hoc/0a0a0a0a-1111-4111-8111-000000000001/bai-tap/00000000-0000-4000-8000-000000000031',
    );
    expect(screen.getByText('8.75 điểm')).toBeInTheDocument();

        const deadlineLink = await screen.findByRole('link', {
      name: 'Bài tập mảng một chiều',
    });

    expect(deadlineLink).toHaveAttribute(
      'href',
      '/sv/mon-hoc/0a0a0a0a-1111-4111-8111-000000000001/bai-tap/00000000-0000-4000-8000-000000000041',
    );
    expect(screen.getByText('Hiển thị 1 trên 1 bài.')).toBeInTheDocument();

    const metric = screen.getByRole('link', { name: /Lượt công bố điểm/ });
    expect(metric).toHaveTextContent('7');
    expect(metric).toHaveAttribute('href', '/sv/diem');

    expect(noticeLink).toHaveAttribute(
      'href',
      '/sv/thong-bao?mon=0a0a0a0a-1111-4111-8111-000000000001&thongBao=25',
    );

    expect(apiClient.untypedRequest).toHaveBeenCalledWith(
      '/api/v1/me/course-announcements',
      expect.objectContaining({
        params: { page: 1, page_size: 3 },
      }),
    );
  });

  it('displays empty state when student is not enrolled in any course', async () => {
    vi.spyOn(coursesService, 'getSummary').mockResolvedValue({
      ...mockStudentSummary,
      open_enrolled_courses: 0,
      total_lessons: 0,
      total_chapters: 0,
      recent_courses: [],
    });

    render(
      <MemoryRouter>
        <StudentDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Bạn chưa tham gia môn học nào trong học kỳ này.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Khám phá môn học' })).toBeInTheDocument();
  });

  it('renders error banner with retry option when student summary API fails', async () => {
    const getSummarySpy = vi
      .spyOn(coursesService, 'getSummary')
      .mockRejectedValueOnce(new Error('Lỗi ủy quyền hoặc phiên làm việc hết hạn'))
      .mockResolvedValueOnce(mockStudentSummary);

    render(
      <MemoryRouter>
        <StudentDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Lỗi ủy quyền hoặc phiên làm việc hết hạn'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Lập trình Cơ bản')).toBeInTheDocument();
    expect(getSummarySpy).toHaveBeenCalledTimes(2);
  });
});


it('does not render fake zero metrics or empty-success text after summary failure', async () => {
  vi.spyOn(coursesService, 'getSummary').mockRejectedValue(new Error('Summary unavailable'));
  render(<MemoryRouter><TeacherDashboardPage /></MemoryRouter>);
  expect(await screen.findByText('Summary unavailable')).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  expect(screen.queryByText('Môn đang phụ trách')).not.toBeInTheDocument();
});
