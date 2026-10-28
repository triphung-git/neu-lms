import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StudentCoursesPage } from '../blueprints/courses/pages/StudentCoursesPage';
import { StudentCourseDetailPage } from '../blueprints/courses/pages/StudentCourseDetailPage';
import { SessionProvider } from '../app/providers/SessionContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import {
  coursesService,
  type Course,
  type CourseCatalogItem,
  type StudentEnrollmentRequest,
  type Chapter,
  type Lesson,
  type CourseMember,
} from '../api/coursesService';
import { authService, type SessionInfo } from '../api/authService';

const mockStudentSession: SessionInfo = {
  id: '0a0a0a0a-1111-4111-8111-000000000099',
  email: 'student.test@neu.edu.vn',
  display_name: 'Sinh Viên Kiểm Thử',
  email_verified: true,
  roles: ['student'],
  pending_roles: [],
  idle_expires_at: '2026-10-27T10:00:00Z',
  absolute_expires_at: '2026-10-28T10:00:00Z',
};

const sampleOpenCourse: Course = {
  id: '0a0a0a0a-1111-4111-8111-000000000001',
  code: 'MIS101',
  name: 'Hệ thống thông tin quản lý',
  term: 'HK1-2026',
  description: 'Nhập môn hệ thống thông tin',
  teacher: '0a0a0a0a-1111-4111-8111-000000000002',
  teacher_name: 'TS. Nguyễn Văn A',
  status: 'open',
  enrollment_open: true,
  archived_at: null,
  active_member_count: 35,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const sampleArchivedCourse: Course = {
  id: '0a0a0a0a-1111-4111-8111-000000000002',
  code: 'ECO201',
  name: 'Kinh tế vi mô nâng cao',
  term: 'HK2-2025',
  description: 'Kinh tế học cơ bản',
  teacher: '0a0a0a0a-1111-4111-8111-000000000002',
  teacher_name: 'TS. Nguyễn Văn A',
  status: 'archived',
  enrollment_open: false,
  archived_at: '2026-05-01T00:00:00Z',
  active_member_count: 40,
  created_at: '2025-10-20T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

const sampleCatalogItems: CourseCatalogItem[] = [
  {
    id: '0a0a0a0a-1111-4111-8111-000000000010',
    code: 'WEB202',
    name: 'Lập trình Web nâng cao',
    term: 'HK1-2026',
    description: 'Xây dựng ứng dụng web hiện đại',
    teacher_name: 'ThS. Trần Thị B',
    enrollment_open: true,
    active_member_count: 20,
    my_enrollment_status: 'not_enrolled',
    pending_request_id: null,
    created_at: '2026-10-21T00:00:00Z',
  },
  {
    id: '0a0a0a0a-1111-4111-8111-000000000011',
    code: 'DB301',
    name: 'Cơ sở dữ liệu phân tán',
    term: 'HK1-2026',
    description: 'Thiết kế CSDL lớn',
    teacher_name: 'PGS. Lê Văn C',
    enrollment_open: true,
    active_member_count: 15,
    my_enrollment_status: 'pending',
    pending_request_id: 'req-pending-001',
    created_at: '2026-10-21T00:00:00Z',
  },
  {
    id: '0a0a0a0a-1111-4111-8111-000000000012',
    code: 'AI401',
    name: 'Trí tuệ nhân tạo',
    term: 'HK1-2026',
    description: 'Học máy cơ bản',
    teacher_name: 'TS. Phạm Minh D',
    enrollment_open: true,
    active_member_count: 50,
    my_enrollment_status: 'enrolled',
    pending_request_id: null,
    created_at: '2026-10-21T00:00:00Z',
  },
];

const sampleStudentRequests: StudentEnrollmentRequest[] = [
  {
    id: 'req-pending-001',
    course_id: '0a0a0a0a-1111-4111-8111-000000000011',
    course_code: 'DB301',
    course_name: 'Cơ sở dữ liệu phân tán',
    course_term: 'HK1-2026',
    teacher_name: 'PGS. Lê Văn C',
    status: 'pending',
    requested_at: '2026-10-25T14:30:00Z',
    reviewed_at: null,
    rejection_reason: '',
    created_at: '2026-10-25T14:30:00Z',
    updated_at: '2026-10-25T14:30:00Z',
  },
  {
    id: 'req-rejected-002',
    course_id: '0a0a0a0a-1111-4111-8111-000000000099',
    course_code: 'DAT201',
    course_name: 'Khoa học dữ liệu',
    course_term: 'HK1-2026',
    teacher_name: 'TS. Vũ Hoàng E',
    status: 'rejected',
    requested_at: '2026-10-22T08:00:00Z',
    reviewed_at: '2026-10-23T09:00:00Z',
    rejection_reason: 'Lớp đã đạt giới hạn sĩ số tối đa 50 sinh viên.',
    created_at: '2026-10-22T08:00:00Z',
    updated_at: '2026-10-23T09:00:00Z',
  },
];

const sampleChapters: Chapter[] = [
  {
    id: 'chap-01',
    course: sampleOpenCourse.id,
    title: 'Tổng quan hệ thống',
    position: 1,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  },
  {
    id: 'chap-02',
    course: sampleOpenCourse.id,
    title: 'Kiến trúc phần mềm',
    position: 2,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  },
];

const chapter1Lessons: Lesson[] = [
  {
    id: 'les-01',
    chapter: 'chap-01',
    title: 'Bài 1: Giới thiệu chung',
    description: 'Nội dung tổng quan về học phần.',
    position: 1,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  },
  {
    id: 'les-02',
    chapter: 'chap-01',
    title: 'Bài 2: Các khái niệm then chốt',
    description: 'Thuật ngữ và nền tảng kiến thức.',
    position: 2,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  },
];

const chapter2Lessons: Lesson[] = [
  {
    id: 'les-03',
    chapter: 'chap-02',
    title: 'Bài 3: Thiết kế kiến trúc',
    description: 'Nội dung chương 2.',
    position: 3,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  },
];

describe('B07-05: Student Courses & Enrollment Requests UI', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(authService, 'getCsrf').mockResolvedValue(undefined);
    vi.spyOn(authService, 'getMe').mockResolvedValue(mockStudentSession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderWithProviders = (ui: React.ReactElement, initialPath = '/sv/mon-hoc') => {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <NotificationProvider>
          <SessionProvider>{ui}</SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );
  };

  describe('StudentCoursesPage', () => {
    it('renders open courses by default and switches to archived tab', async () => {
      const listSpy = vi.spyOn(coursesService, 'list').mockImplementation(async (params) => {
        if (params?.status === 'archived') {
          return {
            items: [sampleArchivedCourse],
            pagination: { page: 1, page_size: 12, total_items: 1, total_pages: 1, has_next: false, has_previous: false },
          };
        }
        return {
          items: [sampleOpenCourse],
          pagination: { page: 1, page_size: 12, total_items: 1, total_pages: 1, has_next: false, has_previous: false },
        };
      });

      renderWithProviders(<StudentCoursesPage />);

      // Verify default tab "Đang học"
      expect(await screen.findByText('Hệ thống thông tin quản lý')).toBeInTheDocument();
      expect(screen.getByText('MIS101')).toBeInTheDocument();
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'student', status: 'open', page: 1 }));

      // Click tab "Đã lưu trữ"
      const archivedTabBtn = screen.getByRole('tab', { name: 'Đã lưu trữ' });
      fireEvent.click(archivedTabBtn);

      expect(await screen.findByText('Kinh tế vi mô nâng cao')).toBeInTheDocument();
      expect(screen.getByText('ECO201')).toBeInTheDocument();
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'student', status: 'archived', page: 1 }));
    });

    it('loads catalog and handles enrollment request submission', async () => {
      vi.spyOn(coursesService, 'list').mockResolvedValue({
        items: [],
        pagination: { page: 1, page_size: 12, total_items: 0, total_pages: 1, has_next: false, has_previous: false },
      });
      const catalogSpy = vi.spyOn(coursesService, 'getCatalog').mockResolvedValue({
        items: sampleCatalogItems,
        pagination: { page: 1, page_size: 12, total_items: 3, total_pages: 1, has_next: false, has_previous: false },
      });
      const enrollSpy = vi.spyOn(coursesService, 'enroll').mockResolvedValue({
        id: 'req-new-001',
        course_id: sampleCatalogItems[0].id,
        course_code: sampleCatalogItems[0].code,
        course_name: sampleCatalogItems[0].name,
        course_term: sampleCatalogItems[0].term,
        teacher_name: sampleCatalogItems[0].teacher_name,
        status: 'pending',
        requested_at: '2026-10-27T00:00:00Z',
        reviewed_at: null,
        rejection_reason: '',
        created_at: '2026-10-27T00:00:00Z',
        updated_at: '2026-10-27T00:00:00Z',
      });

      renderWithProviders(<StudentCoursesPage />);

      // Switch to Catalog tab
      const catalogTabBtn = screen.getByRole('tab', { name: 'Đăng ký môn học' });
      fireEvent.click(catalogTabBtn);

      expect(await screen.findByText('Lập trình Web nâng cao')).toBeInTheDocument();
      expect(screen.getByText('Cơ sở dữ liệu phân tán')).toBeInTheDocument();
      expect(screen.getByText('Trí tuệ nhân tạo')).toBeInTheDocument();
      expect(catalogSpy).toHaveBeenCalled();

      // Click "Đăng ký học" on first course
      const enrollBtn = screen.getByRole('button', { name: 'Đăng ký học' });
      fireEvent.click(enrollBtn);

      await waitFor(() => {
        expect(enrollSpy).toHaveBeenCalledWith(sampleCatalogItems[0].id);
      });
    });

    it('handles cancellation of pending enrollment request from catalog', async () => {
      vi.spyOn(coursesService, 'list').mockResolvedValue({
        items: [],
        pagination: { page: 1, page_size: 12, total_items: 0, total_pages: 1, has_next: false, has_previous: false },
      });
      vi.spyOn(coursesService, 'getCatalog').mockResolvedValue({
        items: sampleCatalogItems,
        pagination: { page: 1, page_size: 12, total_items: 3, total_pages: 1, has_next: false, has_previous: false },
      });
      const cancelSpy = vi.spyOn(coursesService, 'cancelEnrollmentRequest').mockResolvedValue({
        id: 'req-pending-001',
        course_id: sampleCatalogItems[1].id,
        course_code: sampleCatalogItems[1].code,
        course_name: sampleCatalogItems[1].name,
        course_term: sampleCatalogItems[1].term,
        teacher_name: sampleCatalogItems[1].teacher_name,
        status: 'cancelled',
        requested_at: '2026-10-25T14:30:00Z',
        reviewed_at: null,
        rejection_reason: '',
        created_at: '2026-10-25T14:30:00Z',
        updated_at: '2026-10-25T14:30:00Z',
      });

      renderWithProviders(<StudentCoursesPage />);

      // Switch to Catalog tab
      const catalogTabBtn = screen.getByRole('tab', { name: 'Đăng ký môn học' });
      fireEvent.click(catalogTabBtn);

      expect(await screen.findByText('Cơ sở dữ liệu phân tán')).toBeInTheDocument();
      // Second item has status pending, should display "Hủy yêu cầu"
      const cancelBtn = screen.getByRole('button', { name: 'Hủy yêu cầu' });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(cancelSpy).toHaveBeenCalledWith('req-pending-001');
      });
    });

    it('renders "Yêu cầu của tôi" tab with rejection reason when rejected', async () => {
      vi.spyOn(coursesService, 'list').mockResolvedValue({
        items: [],
        pagination: { page: 1, page_size: 12, total_items: 0, total_pages: 1, has_next: false, has_previous: false },
      });
      const requestsSpy = vi.spyOn(coursesService, 'getMyEnrollmentRequests').mockResolvedValue({
        items: sampleStudentRequests,
        pagination: { page: 1, page_size: 12, total_items: 2, total_pages: 1, has_next: false, has_previous: false },
      });

      renderWithProviders(<StudentCoursesPage />);

      // Switch to Requests tab
      const requestsTabBtn = screen.getByRole('tab', { name: 'Yêu cầu của tôi' });
      fireEvent.click(requestsTabBtn);

      expect(await screen.findByText('Khoa học dữ liệu')).toBeInTheDocument();
      expect(screen.getByText('Lớp đã đạt giới hạn sĩ số tối đa 50 sinh viên.')).toBeInTheDocument();
      expect(screen.getAllByText('Đã từ chối').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Đang chờ duyệt').length).toBeGreaterThanOrEqual(1);
      expect(requestsSpy).toHaveBeenCalled();
    });
  });

  describe('StudentCourseDetailPage', () => {
    it('loads course details, chapters and lessons for active enrolled student', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleOpenCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
      vi.spyOn(coursesService, 'listLessons').mockImplementation(async (_cid, chId) => {
        return chId === 'chap-01' ? chapter1Lessons : chapter2Lessons;
      });

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleOpenCourse.id}`]}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      // Verify course header
      expect(await screen.findByText('Hệ thống thông tin quản lý')).toBeInTheDocument();
      expect(screen.getByText('MIS101')).toBeInTheDocument();
      expect(screen.getByText('TS. Nguyễn Văn A')).toBeInTheDocument();

      // Verify chapter tree
      expect(screen.getByText('Chương 1: Tổng quan hệ thống')).toBeInTheDocument();
      expect(screen.getByText('Chương 2: Kiến trúc phần mềm')).toBeInTheDocument();

      // Verify default selected lesson
      expect(screen.getByRole('heading', { name: 'Bài 1: Giới thiệu chung' })).toBeInTheDocument();
      expect(screen.getByText('Nội dung tổng quan về học phần.')).toBeInTheDocument();

      // Verify integrated materials section
      expect(screen.getByRole('heading', { name: /Học liệu bài học/i })).toBeInTheDocument();
    });

    it('navigates to next lesson when clicking "Bài tiếp theo"', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleOpenCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
      vi.spyOn(coursesService, 'listLessons').mockImplementation(async (_cid, chId) => {
        return chId === 'chap-01' ? chapter1Lessons : chapter2Lessons;
      });

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleOpenCourse.id}`]}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(await screen.findByRole('heading', { name: 'Bài 1: Giới thiệu chung' })).toBeInTheDocument();

      const nextBtn = screen.getByRole('button', { name: /Bài tiếp theo/ });
      fireEvent.click(nextBtn);

      expect(await screen.findByRole('heading', { name: 'Bài 2: Các khái niệm then chốt' })).toBeInTheDocument();
    });

    it('shows empty state when student is not enrolled or course returns 404', async () => {
      vi.spyOn(coursesService, 'get').mockRejectedValue({
        status: 404,
        message: 'Not found',
      });

      render(
        <MemoryRouter initialEntries={['/sv/mon-hoc/non-existent-id']}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(await screen.findByText('Chưa được ghi danh')).toBeInTheDocument();
      expect(
        screen.getByText('Môn học không tồn tại hoặc bạn chưa được ghi danh vào môn học này.')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Về danh sách môn học' })).toBeInTheDocument();
    });

    it('executes withdraw flow with confirmation modal', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleOpenCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
      vi.spyOn(coursesService, 'listLessons').mockImplementation(async (_cid, chId) => {
        return chId === 'chap-01' ? chapter1Lessons : chapter2Lessons;
      });

      const withdrawSpy = vi.spyOn(coursesService, 'withdrawMember').mockResolvedValue({
        id: 'mem-001',
        course_id: sampleOpenCourse.id,
        student_id: mockStudentSession.id,
        student_email: mockStudentSession.email,
        student_name: mockStudentSession.display_name,
        status: 'withdrawn',
        added_at: '2026-10-20T00:00:00Z',
        updated_at: '2026-10-27T00:00:00Z',
      });

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleOpenCourse.id}`]}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
                <Route path="/sv/mon-hoc" element={<div>Trang môn học của tôi</div>} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(await screen.findByText('Hệ thống thông tin quản lý')).toBeInTheDocument();

      // Click withdraw button in header
      const withdrawHeaderBtn = screen.getByRole('button', { name: 'Rút khỏi môn học' });
      fireEvent.click(withdrawHeaderBtn);

      // Confirm modal opens
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Xác nhận rút khỏi môn học')).toBeInTheDocument();

      // Click confirm
      const confirmBtn = screen.getByRole('button', { name: 'Xác nhận rút môn' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(withdrawSpy).toHaveBeenCalledWith(sampleOpenCourse.id, mockStudentSession.id);
      });

      // Verify navigation back to /sv/mon-hoc
      expect(await screen.findByText('Trang môn học của tôi')).toBeInTheDocument();
    });

    it('displays notice box for unintegrated modules without fake seed data', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleOpenCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
      vi.spyOn(coursesService, 'listLessons').mockImplementation(async (_cid, chId) => {
        return chId === 'chap-01' ? chapter1Lessons : chapter2Lessons;
      });

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleOpenCourse.id}`]}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(await screen.findByText('Hệ thống thông tin quản lý')).toBeInTheDocument();

      // Click tab "Bài tập"
      const assignmentsTabBtn = screen.getByRole('button', { name: 'Bài tập' });
      fireEvent.click(assignmentsTabBtn);

      expect(await screen.findByText('Danh sách bài tập môn học')).toBeInTheDocument();

      // Click tab "Bảng điểm"
      const gradesTabBtn = screen.getByRole('button', { name: 'Bảng điểm' });
      fireEvent.click(gradesTabBtn);

      expect(await screen.findByText(/Phân hệ Chấm điểm & Bảng điểm \(B12\)/)).toBeInTheDocument();
    });
  });
  it('shows a retryable error when any lesson request fails instead of an empty lesson list', async () => {
    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleOpenCourse);
    vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
    vi.spyOn(coursesService, 'listLessons').mockRejectedValue(new Error('Lesson network failed'));
    renderWithProviders(<Routes><Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} /></Routes>, `/sv/mon-hoc/${sampleOpenCourse.id}`);
    expect(await screen.findByText('Lesson network failed')).toBeInTheDocument();
    expect(screen.queryByText('Nội dung tổng quan về học phần.')).not.toBeInTheDocument();
  });

  it('keeps chapter order when lesson positions restart inside each chapter', async () => {
    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleOpenCourse);
    vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
    vi.spyOn(coursesService, 'listLessons').mockImplementation(async (_id, chapter) => chapter === 'chap-01' ? chapter1Lessons : chapter2Lessons.map(item => ({ ...item, position: 1 })));
    renderWithProviders(<Routes><Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} /></Routes>, `/sv/mon-hoc/${sampleOpenCourse.id}`);
    await screen.findByRole('heading', { name: chapter1Lessons[0].title });
    fireEvent.click(screen.getByRole('button', { name: /Bài tiếp theo/ }));
    expect(await screen.findByRole('heading', { name: chapter1Lessons[1].title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bài tiếp theo/ }));
    expect(await screen.findByRole('heading', { name: chapter2Lessons[0].title })).toBeInTheDocument();
  });

});
