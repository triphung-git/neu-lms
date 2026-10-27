import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeacherDashboardPage } from '../blueprints/dashboards/pages/TeacherDashboardPage';
import { StudentDashboardPage } from '../blueprints/dashboards/pages/StudentDashboardPage';
import { coursesService, type CourseSummaryResponse } from '../api/coursesService';

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
  pending_submissions: null,
  problem_materials: null,
  pending_ai_drafts: null,
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
    'pending_submissions',
    'upcoming_deadlines',
    'problem_materials',
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

    // Verifies service call with role 'teacher'
    expect(getSummarySpy).toHaveBeenCalledWith('teacher');

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
    const unavailableBadges = screen.getAllByText('Chưa khả dụng');
    expect(unavailableBadges.length).toBeGreaterThanOrEqual(1);
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

    expect(await screen.findByText('Lập trình Cơ bản')).toBeInTheDocument();
    expect(screen.getByText('CS101')).toBeInTheDocument();
    expect(screen.getByText(/TS\. Nguyễn Văn A/)).toBeInTheDocument();
    expect(screen.getByText(/6 bài học/)).toBeInTheDocument();

    // Unavailable badges for future modules (Assignments, Grades, Announcements)
    const unavailableBadges = screen.getAllByText('Chưa khả dụng');
    expect(unavailableBadges.length).toBeGreaterThanOrEqual(3);
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
