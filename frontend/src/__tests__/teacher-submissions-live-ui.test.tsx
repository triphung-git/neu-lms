import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { assignmentsService } from '../api/assignmentsService';
import { coursesService } from '../api/coursesService';
import { TeacherSubmissionsPage } from '../blueprints/submissions';

const assignment = {
  id: '11111111-1111-4111-8111-111111111111',
  course_id: '22222222-2222-4222-8222-222222222222',
  title: 'Bài tập API thật',
  due_at: '2026-11-15T23:59:00+07:00',
  total_score: 10,
} as Awaited<ReturnType<typeof assignmentsService.getAssignmentDirect>>;

const course = {
  id: assignment.course_id,
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
} as Awaited<ReturnType<typeof coursesService.get>>;

const gradebook = {
  course_name: course.name,
  assignments: [{ id: assignment.id, title: assignment.title }],
  assignment_id: assignment.id,
  total_score: '10.00',
  items: [
    {
      student_id: '44444444-4444-4444-8444-444444444444',
      name: 'Nguyễn Văn A',
      email: 'a@example.edu.vn',
      revision_number: 1,
      latest_grade: { score: '8.50', status: 'published' as const },
      published_grade: { score: '8.50', status: 'published' as const },
    },
    {
      student_id: '55555555-5555-4555-8555-555555555555',
      name: 'Trần Thị B',
      email: 'b@example.edu.vn',
      revision_number: null,
      latest_grade: null,
      published_grade: null,
    },
  ],
  pagination: {
    page: 1,
    page_size: 100,
    total_items: 2,
    total_pages: 1,
    has_next: false,
    has_previous: false,
  },
};

const submissions = {
  title: assignment.title,
  course_id: course.id,
  items: [
    {
      id: 501,
      number: 1,
      file_name: 'bai-lam.zip',
      file_size: 2048,
      submitted_at: '2026-11-01T09:00:00Z',
      is_late: false,
      student_id: '44444444-4444-4444-8444-444444444444',
      student_name: 'Nguyễn Văn A',
      student_email: 'a@example.edu.vn',
      file_id: '66666666-6666-4666-8666-666666666666',
    },
  ],
  pagination: {
    page: 1,
    page_size: 100,
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

describe('TeacherSubmissionsPage - API integration', () => {
  it('loads assignment roster, latest submissions and published grades from backend APIs', async () => {
    vi.spyOn(assignmentsService, 'getAssignmentDirect').mockResolvedValue(assignment);
    vi.spyOn(assignmentsService, 'getTeacherGradebook').mockResolvedValue(gradebook);
    vi.spyOn(assignmentsService, 'listTeacherSubmissions').mockResolvedValue(submissions);
    vi.spyOn(coursesService, 'get').mockResolvedValue(course);

    render(
      <MemoryRouter initialEntries={[`/gv/bai-tap/${assignment.id}/bai-nop`]}>
        <Routes>
          <Route path="/gv/bai-tap/:baiTapId/bai-nop" element={<TeacherSubmissionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: `Danh sách bài nộp: ${assignment.title}` })).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('Trần Thị B')).toBeInTheDocument();
    expect(screen.getByText('bai-lam.zip')).toBeInTheDocument();
    expect(screen.getByText(/8,5 \/ 10/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Xem lại/i })).toHaveAttribute('href', '/gv/bai-nop/501/cham');
    expect(assignmentsService.getTeacherGradebook).toHaveBeenCalledWith(
      course.id,
      assignment.id,
      { page: 1, page_size: 100 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('shows a retryable error state when backend denies or fails the request', async () => {
    vi.spyOn(assignmentsService, 'getAssignmentDirect').mockRejectedValue(new Error('Không có quyền truy cập.'));

    render(
      <MemoryRouter initialEntries={[`/gv/bai-tap/${assignment.id}/bai-nop`]}>
        <Routes>
          <Route path="/gv/bai-tap/:baiTapId/bai-nop" element={<TeacherSubmissionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Không có quyền truy cập.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Thử lại/i })).toBeInTheDocument();
  });
});
