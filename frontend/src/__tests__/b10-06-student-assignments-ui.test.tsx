import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StudentAssignmentDetailPage } from '../blueprints/assignments/pages/StudentAssignmentDetailPage';
import { StudentCourseDetailPage } from '../blueprints/courses/pages/StudentCourseDetailPage';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { SessionProvider } from '../app/providers/SessionContext';
import {
  assignmentsService,
  type AssignmentDetail,
  type StudentAssignmentEligibility,
  type PaginatedAssignmentSummaryList,
} from '../api/assignmentsService';
import { coursesService, type Course } from '../api/coursesService';
import { materialsService } from '../api/materialsService';
import { ApiError } from '../api/client';
import { getAssignmentService, resetAssignmentService } from '../app/composition/assignmentWiring';
import { HttpAssignmentsAdapter } from '../blueprints/assignments/adapters/httpAssignmentsAdapter';

// Sample Fixtures
const sampleCourse: Course = {
  id: '0a0a0a0a-1111-4111-8111-000000000001',
  code: 'CS101',
  name: 'Lập trình hướng đối tượng',
  term: 'HK1-2026',
  description: 'Khóa học OOP thực hành',
  teacher: '0a0a0a0a-1111-4111-8111-000000000002',
  teacher_name: 'TS. Nguyễn Văn A',
  status: 'open',
  enrollment_open: true,
  archived_at: null,
  active_member_count: 30,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const samplePublishedAssignment: AssignmentDetail = {
  id: 'ass-uuid-001',
  course_id: sampleCourse.id,
  chapter_id: 'chap-1',
  lesson_id: null,
  title: 'Bài tập 1: Xây dựng lớp SinhVien',
  instructions: 'Viết chương trình Java mô hình hóa đối tượng SinhVien có đóng gói dữ liệu.',
  status: 'published',
  due_at: '2026-11-15T23:59:00+07:00',
  allow_late: false,
  manually_closed_at: null,
  total_score: 10,
  rubric_criteria: [
    {
      id: 'crit-1',
      title: 'Thiết kế cấu trúc lớp',
      description: 'Định nghĩa đúng thuộc tính private và phương thức get/set',
      max_score: '4.00',
      position: 1,
    },
    {
      id: 'crit-2',
      title: 'Xử lý logic và tính toán điểm',
      description: 'Tính toán điểm trung bình chính xác',
      max_score: '6.00',
      position: 2,
    },
  ],
  file_policy: {
    id: 'fp-1',
    version: 1,
    allowed_extensions: ['pdf', 'docx', 'zip'],
    max_file_size_bytes: 25 * 1024 * 1024,
    max_files_per_submission: 1,
  },
  attachments: [
    {
      id: 'att-1',
      file_id: 'file-1',
      name: 'De_bai_chi_tiet.pdf',
      size_bytes: 102400,
      mime_type: 'application/pdf',
      sha256_hash: 'abc123hash',
      download_url: '/api/v1/courses/0a0a0a0a-1111-4111-8111-000000000001/assignments/ass-uuid-001/attachments/att-1/download',
      preview_url: '/api/v1/courses/0a0a0a0a-1111-4111-8111-000000000001/assignments/ass-uuid-001/attachments/att-1/preview',
      created_at: '2026-10-25T08:00:00Z',
    },
  ],
  ai_grading_opt_in: false,
  is_submission_window_open: true,
  published_at: '2026-10-25T08:00:00Z',
  created_at: '2026-10-25T08:00:00Z',
  updated_at: '2026-10-25T08:00:00Z',
  version: 1,
};

const sampleEligibilityOpen = {
  can_submit: true,
  can_replace: false,
  is_late: false,
  reason: null,
  server_time: '2026-10-28T12:00:00Z',
  deadline: '2026-11-15T23:59:00+07:00',
  effective_deadline: '2026-11-15T23:59:00+07:00',
  allow_late: false,
  manually_closed: false,
  course_archived: false,
  has_reopen_window: false,
  reopen_window_end: null,
  active_submission_count: 0,
  max_revisions: 5,
  is_reopen_for_actor: false,
  contract_version: '1.0',
} as unknown as StudentAssignmentEligibility;

const sampleEligibilityClosed = {
  can_submit: false,
  can_replace: false,
  is_late: false,
  reason: 'Hạn chót nộp bài đã kết thúc và bài tập không cho phép nộp muộn.',
  server_time: '2026-11-16T12:00:00Z',
  deadline: '2026-11-15T23:59:00+07:00',
  effective_deadline: '2026-11-15T23:59:00+07:00',
  allow_late: false,
  manually_closed: true,
  course_archived: false,
  has_reopen_window: false,
  reopen_window_end: null,
  active_submission_count: 0,
  max_revisions: 5,
  is_reopen_for_actor: false,
  contract_version: '1.0',
} as unknown as StudentAssignmentEligibility;

const sampleEligibilityLateAllowed = {
  can_submit: true,
  can_replace: false,
  is_late: true,
  reason: null,
  server_time: '2026-11-16T12:00:00Z',
  deadline: '2026-11-15T23:59:00+07:00',
  effective_deadline: '2026-11-15T23:59:00+07:00',
  allow_late: true,
  manually_closed: false,
  course_archived: false,
  has_reopen_window: false,
  reopen_window_end: null,
  active_submission_count: 0,
  max_revisions: 5,
  is_reopen_for_actor: false,
  contract_version: '1.0',
} as unknown as StudentAssignmentEligibility;

describe('B10-06: Student Assignment Detail & List Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAssignmentService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAssignmentService();
  });

  describe('Production Wiring & Architecture Enforcement', () => {
    it('verifies that assignmentWiring defaults to HttpAssignmentsAdapter in production', () => {
      const activeService = getAssignmentService();
      expect(activeService).toBeInstanceOf(HttpAssignmentsAdapter);
    });
  });

  describe('StudentAssignmentDetailPage Rendering & Data Display', () => {
    it('renders statement, attachments, and rubric criteria belonging to authorized published version', async () => {
      vi.spyOn(assignmentsService, 'getAssignmentDirect').mockResolvedValue(samplePublishedAssignment);
      vi.spyOn(assignmentsService, 'getStudentEligibilityDirect').mockResolvedValue(sampleEligibilityOpen);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-001']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      // Loading skeleton should disappear
      await waitFor(() => {
        expect(screen.getByTestId('student-assignment-detail')).toBeInTheDocument();
      });

      // Assignment title and instructions
      expect(screen.getByTestId('assignment-title')).toHaveTextContent('Bài tập 1: Xây dựng lớp SinhVien');
      expect(screen.getByTestId('assignment-instructions')).toHaveTextContent(
        'Viết chương trình Java mô hình hóa đối tượng SinhVien có đóng gói dữ liệu.'
      );

      // Rubric criteria table
      expect(screen.getByText('Thiết kế cấu trúc lớp')).toBeInTheDocument();
      expect(screen.getByText('Định nghĩa đúng thuộc tính private và phương thức get/set')).toBeInTheDocument();
      expect(screen.getByText('Xử lý logic và tính toán điểm')).toBeInTheDocument();
      expect(screen.getByText('4,0 đ')).toBeInTheDocument();
      expect(screen.getByText('6,0 đ')).toBeInTheDocument();

      // Attachments list
      expect(screen.getByText('De_bai_chi_tiet.pdf')).toBeInTheDocument();
      expect(screen.getByText('(100.0 KB)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /tải về/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /xem trước/i })).toBeInTheDocument();

      // Eligibility badge & button
      expect(screen.getByText('Đang nhận bài')).toBeInTheDocument();
      expect(screen.getByTestId('submit-assignment-btn')).toBeEnabled();
    });

    it('renders server-provided closed state and blocks submission when closed', async () => {
      vi.spyOn(assignmentsService, 'getAssignmentDirect').mockResolvedValue({
        ...samplePublishedAssignment,
        status: 'closed',
      });
      vi.spyOn(assignmentsService, 'getStudentEligibilityDirect').mockResolvedValue(sampleEligibilityClosed);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-001']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('student-assignment-detail')).toBeInTheDocument();
      });

      // Closed notice and alert
      expect(screen.getByTestId('closed-alert')).toBeInTheDocument();
      expect(screen.getByTestId('submission-locked')).toBeInTheDocument();
      expect(screen.queryByTestId('submit-assignment-btn')).not.toBeInTheDocument();
    });

    it('displays warning chip when deadline is passed but late submissions are allowed', async () => {
      vi.spyOn(assignmentsService, 'getAssignmentDirect').mockResolvedValue({
        ...samplePublishedAssignment,
        allow_late: true,
      });
      vi.spyOn(assignmentsService, 'getStudentEligibilityDirect').mockResolvedValue(sampleEligibilityLateAllowed);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-001']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('student-assignment-detail')).toBeInTheDocument();
      });

      expect(screen.getByText('Quá hạn (Cho nộp muộn)')).toBeInTheDocument();
      expect(screen.getAllByText(/Nộp muộn/i).length).toBeGreaterThan(0);
      expect(screen.getByTestId('submit-assignment-btn')).toBeEnabled();
    });

    it('supports course-nested deep link /sv/mon-hoc/:monId/bai-tap/:baiTapId', async () => {
      const getAssSpy = vi.spyOn(assignmentsService, 'getAssignment').mockResolvedValue(samplePublishedAssignment);
      const getEligSpy = vi.spyOn(assignmentsService, 'getStudentEligibility').mockResolvedValue(sampleEligibilityOpen);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}/bai-tap/${samplePublishedAssignment.id}`]}>
            <Routes>
              <Route
                path="/sv/mon-hoc/:monId/bai-tap/:baiTapId"
                element={<StudentAssignmentDetailPage />}
              />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('student-assignment-detail')).toBeInTheDocument();
      });

      expect(getAssSpy).toHaveBeenCalledWith(sampleCourse.id, samplePublishedAssignment.id, expect.any(Object));
      expect(getEligSpy).toHaveBeenCalledWith(
        sampleCourse.id,
        samplePublishedAssignment.id,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe('Milestone B11 / B12 Boundary & Honest Deferred Action', () => {
    it('notifies user honestly of pending Milestone B11 intake when clicking submit', async () => {
      vi.spyOn(assignmentsService, 'getAssignmentDirect').mockResolvedValue(samplePublishedAssignment);
      vi.spyOn(assignmentsService, 'getStudentEligibilityDirect').mockResolvedValue(sampleEligibilityOpen);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-001']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('submit-assignment-btn')).toBeInTheDocument();
      });

      const submitBtn = screen.getByTestId('submit-assignment-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Milestone B11/i)).toBeInTheDocument();
      });
    });

    it('displays honest card indicating grading results and feedback start at Milestone B12', async () => {
      vi.spyOn(assignmentsService, 'getAssignmentDirect').mockResolvedValue(samplePublishedAssignment);
      vi.spyOn(assignmentsService, 'getStudentEligibilityDirect').mockResolvedValue(sampleEligibilityOpen);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-001']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('student-assignment-detail')).toBeInTheDocument();
      });

      expect(screen.getByText(/Kết quả đánh giá & Điểm số \(Phân hệ B12\)/i)).toBeInTheDocument();
    });
  });

  describe('Permission Denied & Error Retry Scenarios', () => {
    it('renders permission denied EmptyState when server returns 403 (draft or not enrolled)', async () => {
      vi.spyOn(assignmentsService, 'getAssignmentDirect').mockRejectedValue(
        new ApiError(403, { message: 'Bài tập chưa được công bố.', code: '403' })
      );

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-draft']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Không có quyền truy cập')).toBeInTheDocument();
      });
      expect(screen.getByText('Bài tập chưa được công bố.')).toBeInTheDocument();
    });

    it('renders not found EmptyState when server returns 404', async () => {
      vi.spyOn(assignmentsService, 'getAssignmentDirect').mockRejectedValue(
        new ApiError(404, { message: 'Bài tập không tồn tại.', code: '404' })
      );

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-unknown']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Không tìm thấy bài tập')).toBeInTheDocument();
      });
    });

    it('allows retrying fetch when network error occurs', async () => {
      const getSpy = vi.spyOn(assignmentsService, 'getAssignmentDirect')
        .mockRejectedValueOnce(new Error('Mạng bị gián đoạn'))
        .mockResolvedValueOnce(samplePublishedAssignment);
      vi.spyOn(assignmentsService, 'getStudentEligibilityDirect').mockResolvedValue(sampleEligibilityOpen);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={['/sv/bai-tap/ass-uuid-001']}>
            <Routes>
              <Route path="/sv/bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Không tìm thấy bài tập')).toBeInTheDocument();
      });

      // Click "Thử lại"
      const retryBtn = screen.getByRole('button', { name: /thử lại/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByTestId('student-assignment-detail')).toBeInTheDocument();
      });

      expect(getSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('StudentCourseDetailPage: Tab Bài tập Integration', () => {
    it('fetches and displays published assignments list in course detail tab bai-tap', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue([]);
      vi.spyOn(materialsService, 'listMaterials').mockResolvedValue({
        items: [],
        pagination: { page: 1, page_size: 20, total_items: 0, total_pages: 1, has_next: false, has_previous: false },
      });

      const publishedList: PaginatedAssignmentSummaryList = {
        items: [
          {
            id: 'ass-uuid-001',
            course_id: sampleCourse.id,
            chapter_id: null,
            lesson_id: null,
            title: 'Bài tập 1: Xây dựng lớp SinhVien',
            status: 'published',
            due_at: '2026-11-15T23:59:00+07:00',
            allow_late: true,
            manually_closed_at: null,
            total_score: 10,
            rubric_count: 2,
            attachment_count: 1,
            submission_count: 0,
            graded_count: 0,
            ai_grading_opt_in: false,
            published_at: '2026-10-25T08:00:00Z',
            created_at: '2026-10-25T08:00:00Z',
            updated_at: '2026-10-25T08:00:00Z',
            version: 1,
          },
        ],
        pagination: {
          page: 1,
          page_size: 20,
          total_items: 1,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        },
      };

      const listSpy = vi.spyOn(assignmentsService, 'listPublishedAssignments').mockResolvedValue(publishedList);

      render(
        <NotificationProvider>
          <SessionProvider>
            <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}?tab=bai-tap`]}>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </MemoryRouter>
          </SessionProvider>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('student-assignments-tab')).toBeInTheDocument();
      });

      expect(listSpy).toHaveBeenCalledWith(sampleCourse.id, expect.any(Object), expect.any(Object));
      expect(screen.getByText('Bài tập 1: Xây dựng lớp SinhVien')).toBeInTheDocument();
      expect(screen.getByText('10 điểm')).toBeInTheDocument();
      expect(screen.getByText('2 tiêu chí rubric')).toBeInTheDocument();
      expect(screen.getByText('1 tệp đính kèm')).toBeInTheDocument();
      expect(screen.getByText('(Cho phép nộp muộn)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /xem chi tiết/i })).toBeInTheDocument();
    });

    it('renders empty state when course has no published assignments', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue([]);
      vi.spyOn(materialsService, 'listMaterials').mockResolvedValue({
        items: [],
        pagination: { page: 1, page_size: 20, total_items: 0, total_pages: 1, has_next: false, has_previous: false },
      });
      vi.spyOn(assignmentsService, 'listPublishedAssignments').mockResolvedValue({
        items: [],
        pagination: {
          page: 1,
          page_size: 20,
          total_items: 0,
          total_pages: 0,
          has_next: false,
          has_previous: false,
        },
      });

      render(
        <NotificationProvider>
          <SessionProvider>
            <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}?tab=bai-tap`]}>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </MemoryRouter>
          </SessionProvider>
        </NotificationProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Chưa có bài tập nào')).toBeInTheDocument();
      });
      expect(screen.getByText('Giảng viên chưa công bố bài tập nào cho môn học này.')).toBeInTheDocument();
    });
  });
});
