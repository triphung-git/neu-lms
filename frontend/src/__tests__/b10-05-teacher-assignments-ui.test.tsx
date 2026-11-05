import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TeacherAssignmentListPage } from '../blueprints/assignments/pages/TeacherAssignmentListPage';
import { TeacherAssignmentEditPage } from '../blueprints/assignments/pages/TeacherAssignmentEditPage';
import { NotificationProvider } from '../app/providers/NotificationContext';
import {
  assignmentsService,
  type AssignmentSummaryItem,
  type AssignmentDetail,
  type AssignmentReopenWindow,
} from '../api/assignmentsService';
import { filesService } from '../api/filesService';
import { coursesService, type Course, type Chapter } from '../api/coursesService';
import { ApiError } from '../api/client';

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

const sampleArchivedCourse: Course = {
  ...sampleCourse,
  id: '0a0a0a0a-1111-4111-8111-000000000002',
  status: 'archived',
  archived_at: '2026-05-01T00:00:00Z',
};

const sampleChapter: Chapter = {
  id: '0c0c0c0c-1111-4111-8111-000000000001',
  course: sampleCourse.id,
  title: 'Chương 1: Lập trình Java cơ bản',
  position: 1,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const sampleDraftSummary: AssignmentSummaryItem = {
  id: 'ass-uuid-001',
  course_id: sampleCourse.id,
  chapter_id: sampleChapter.id,
  lesson_id: null,
  title: 'Bài tập 1: Xây dựng lớp SinhVien',
  status: 'draft',
  due_at: '2026-11-15T23:59:00+07:00',
  allow_late: true,
  manually_closed_at: null,
  total_score: 10,
  rubric_count: 3,
  attachment_count: 1,
  submission_count: 0,
  graded_count: 0,
  ai_grading_opt_in: false,
  published_at: null,
  created_at: '2026-10-25T08:00:00Z',
  updated_at: '2026-10-25T08:00:00Z',
  version: 1,
};

const samplePublishedSummary: AssignmentSummaryItem = {
  id: 'ass-uuid-002',
  course_id: sampleCourse.id,
  chapter_id: sampleChapter.id,
  lesson_id: null,
  title: 'Bài tập lớn: Hệ thống LMS',
  status: 'published',
  due_at: '2026-11-20T23:59:00+07:00',
  allow_late: false,
  manually_closed_at: null,
  total_score: 10,
  rubric_count: 4,
  attachment_count: 2,
  submission_count: 15,
  graded_count: 5,
  ai_grading_opt_in: false,
  published_at: '2026-10-26T10:00:00Z',
  created_at: '2026-10-25T08:00:00Z',
  updated_at: '2026-10-26T10:00:00Z',
  version: 2,
};

const sampleClosedSummary: AssignmentSummaryItem = {
  id: 'ass-uuid-003',
  course_id: sampleCourse.id,
  chapter_id: null,
  lesson_id: null,
  title: 'Kiểm tra giữa kỳ',
  status: 'closed',
  due_at: '2026-10-27T10:00:00+07:00',
  allow_late: false,
  manually_closed_at: '2026-10-27T10:05:00+07:00',
  total_score: 10,
  rubric_count: 2,
  attachment_count: 0,
  submission_count: 28,
  graded_count: 28,
  ai_grading_opt_in: false,
  published_at: '2026-10-20T08:00:00Z',
  created_at: '2026-10-20T08:00:00Z',
  updated_at: '2026-10-27T10:05:00Z',
  version: 3,
};

const sampleDetailDraft: AssignmentDetail = {
  id: 'ass-uuid-001',
  course_id: sampleCourse.id,
  chapter_id: sampleChapter.id,
  lesson_id: null,
  title: 'Bài tập 1: Xây dựng lớp SinhVien',
  instructions: 'Viết chương trình Java quản lý thông tin sinh viên với OOP',
  status: 'draft',
  due_at: '2026-11-15T23:59:00+07:00',
  allow_late: true,
  manually_closed_at: null,
  total_score: 10,
  version: 1,
  is_submission_window_open: false,
  ai_grading_opt_in: false,
  published_at: null,
  created_at: '2026-10-25T08:00:00Z',
  updated_at: '2026-10-25T08:00:00Z',
  file_policy: {
    id: 'fp-001',
    max_files_per_submission: 3,
    max_file_size_bytes: 25 * 1024 * 1024,
    allowed_extensions: ['pdf', 'docx', 'zip'],
    version: 1,
  },
  attachments: [
    {
      id: 'att-001',
      file_id: 'file-001',
      name: 'De-bai-tap-1.pdf',
      size_bytes: 1024 * 100,
      mime_type: 'application/pdf',
      sha256_hash: 'a'.repeat(64),
      download_url: '/api/v1/courses/c/assignments/a/attachments/f/download',
      preview_url: '/api/v1/courses/c/assignments/a/attachments/f/preview',
      created_at: '2026-10-25T08:00:00Z',
    },
  ],
  rubric_criteria: [
    {
      id: 'cr-001',
      title: 'Thiết kế class và encapsulation',
      description: 'Đầy đủ getter/setter và validate',
      max_score: '5.00',
      position: 1,
    },
    {
      id: 'cr-002',
      title: 'Kiểm thử unit test JUnit',
      description: 'Bao phủ các ca kiểm thử',
      max_score: '5.00',
      position: 2,
    },
  ],
};

const sampleDetailPublished: AssignmentDetail = {
  ...sampleDetailDraft,
  id: 'ass-uuid-002',
  title: 'Bài tập lớn: Hệ thống LMS',
  status: 'published',
  version: 2,
  published_at: '2026-10-26T10:00:00Z',
  is_submission_window_open: true,
};

const sampleReopenWindow: AssignmentReopenWindow = {
  id: 'win-001',
  assignment_id: 'ass-uuid-003',
  target_type: 'all',
  student_id: null,
  student_display_name: 'Cả lớp',
  student_email: '',
  start_at: '2026-10-27T12:00:00Z',
  end_at: '2026-10-28T23:59:00Z',
  scope: 'all_actions',
  reason: 'Mở lại cho sinh viên nộp bổ sung',
  is_active: true,
  created_at: '2026-10-27T12:00:00Z',
};

describe('B10-05: Teacher Assignments Flow UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
    vi.spyOn(coursesService, 'listChapters').mockResolvedValue([sampleChapter]);
    vi.spyOn(assignmentsService, 'listTeacherAssignments').mockResolvedValue({
      items: [sampleDraftSummary, samplePublishedSummary, sampleClosedSummary],
      pagination: {
        page: 1,
        page_size: 10,
        total_items: 3,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TeacherAssignmentListPage', () => {
    it('1. Renders assignment list with real contracts and course metadata', async () => {
      render(
        <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap"
                element={<TeacherAssignmentListPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Bài tập & Đề thi học phần')).toBeInTheDocument();
        expect(screen.getByText('Bài tập 1: Xây dựng lớp SinhVien')).toBeInTheDocument();
        expect(screen.getByText('Bài tập lớn: Hệ thống LMS')).toBeInTheDocument();
        expect(screen.getByText('Kiểm tra giữa kỳ')).toBeInTheDocument();
      });

      expect(assignmentsService.listTeacherAssignments).toHaveBeenCalledWith(
        sampleCourse.id,
        expect.objectContaining({ page: 1, page_size: 10 })
      );
    });

    it('2. Filters by status tabs: published, draft, closed', async () => {
      render(
        <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap"
                element={<TeacherAssignmentListPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Đang mở/i })).toBeInTheDocument();
      });

      // Click "Đang mở" tab
      fireEvent.click(screen.getByRole('tab', { name: /Đang mở/i }));

      await waitFor(() => {
        expect(assignmentsService.listTeacherAssignments).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({ status: 'published' })
        );
      });
    });

    it('3. Searches with query keyword', async () => {
      render(
        <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap"
                element={<TeacherAssignmentListPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Tìm kiếm theo tiêu đề bài tập...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Tìm kiếm theo tiêu đề bài tập...');
      fireEvent.change(searchInput, { target: { value: 'SinhVien' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));

      await waitFor(() => {
        expect(assignmentsService.listTeacherAssignments).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({ search: 'SinhVien' })
        );
      });
    });

    it('4. Handles manual close modal interaction', async () => {
      vi.spyOn(assignmentsService, 'closeAssignment').mockResolvedValue(sampleDetailPublished);

      render(
        <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap"
                element={<TeacherAssignmentListPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId(`btn-close-${samplePublishedSummary.id}`)).toBeInTheDocument();
      });

      // Click close button on published assignment
      fireEvent.click(screen.getByTestId(`btn-close-${samplePublishedSummary.id}`));

      // Verify modal is open
      expect(screen.getByText('Xác nhận đóng cổng nhận bài nộp')).toBeInTheDocument();

      // Enter close reason
      const reasonInput = screen.getByPlaceholderText(/Hết thời gian làm bài/i);
      fireEvent.change(reasonInput, { target: { value: 'Đã hết giờ làm bài chính thức' } });

      // Confirm close
      fireEvent.click(screen.getByTestId('confirm-close-btn'));

      await waitFor(() => {
        expect(assignmentsService.closeAssignment).toHaveBeenCalledWith(
          sampleCourse.id,
          samplePublishedSummary.id,
          expect.objectContaining({
            close_type: 'manual_close',
            reason: 'Đã hết giờ làm bài chính thức',
          })
        );
      });
    });

    it('5. Opens and manages Reopen Windows modal for closed assignment', async () => {
      vi.spyOn(assignmentsService, 'listReopenWindows').mockResolvedValue([sampleReopenWindow]);
      vi.spyOn(assignmentsService, 'createReopenWindow').mockResolvedValue(sampleReopenWindow);
      vi.spyOn(assignmentsService, 'revokeReopenWindow').mockResolvedValue({
        ...sampleReopenWindow,
        is_active: false,
      });

      render(
        <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap"
                element={<TeacherAssignmentListPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId(`btn-reopen-windows-${sampleClosedSummary.id}`)).toBeInTheDocument();
      });

      // Open reopen windows modal
      fireEvent.click(screen.getByTestId(`btn-reopen-windows-${sampleClosedSummary.id}`));

      await waitFor(() => {
        expect(screen.getByText(/Quản lý cửa sổ mở lại/i)).toBeInTheDocument();
        expect(screen.getByText('Cả lớp')).toBeInTheDocument();
      });

      // Submit new reopen window
      fireEvent.click(screen.getByTestId('btn-submit-reopen-window'));

      await waitFor(() => {
        expect(assignmentsService.createReopenWindow).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleClosedSummary.id,
          expect.objectContaining({
            target_type: 'all',
            scope: 'all_actions',
          })
        );
      });
    });

    it('6. Enforces read-only mode and disables creation when course is archived', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleArchivedCourse);

      render(
        <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleArchivedCourse.id}/bai-tap`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap"
                element={<TeacherAssignmentListPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Môn học đã lưu trữ: Toàn bộ bài tập ở trạng thái chỉ đọc/i)).toBeInTheDocument();
      });

      // "Soạn bài tập mới" button must NOT be present
      expect(screen.queryByTestId('btn-create-assignment')).not.toBeInTheDocument();
      // Action mutation buttons must NOT be present
      expect(screen.queryByTestId(`btn-close-${samplePublishedSummary.id}`)).not.toBeInTheDocument();
    });
  });

  describe('TeacherAssignmentEditPage', () => {
    it('7. Creates a new draft assignment with rubric and future file policy', async () => {
      vi.spyOn(assignmentsService, 'createAssignment').mockResolvedValue(sampleDetailDraft);

      render(
        <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap/soan`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap/soan"
                element={<TeacherAssignmentEditPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'Soạn bài tập mới' })).toBeInTheDocument();
      });

      // Fill in title and instructions
      const titleInput = screen.getByLabelText(/Tiêu đề bài tập/i);
      fireEvent.change(titleInput, { target: { value: 'Bài tập 2: Kế thừa & Đa hình' } });

      const descInput = screen.getByLabelText(/Yêu cầu đề bài/i);
      fireEvent.change(descInput, { target: { value: 'Viết các lớp kế thừa từ Person' } });

      // Save draft
      fireEvent.click(screen.getByTestId('btn-save-draft'));

      await waitFor(() => {
        expect(assignmentsService.createAssignment).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({
            title: 'Bài tập 2: Kế thừa & Đa hình',
            instructions: 'Viết các lớp kế thừa từ Person',
            publish_immediately: false,
          }),
          expect.objectContaining({ idempotencyKey: expect.any(String) }),
        );
      });
    });

    it('8. Loads existing draft and updates with optimistic concurrency check', async () => {
      vi.spyOn(assignmentsService, 'getTeacherAssignment').mockResolvedValue(sampleDetailDraft);
      vi.spyOn(assignmentsService, 'updateAssignment').mockResolvedValue({
        ...sampleDetailDraft,
        title: 'Bài tập 1: Xây dựng lớp SinhVien (Đã sửa)',
        version: 2,
      });

      render(
        <MemoryRouter
          initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap/soan?baiTap=${sampleDetailDraft.id}`]}
        >
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap/soan"
                element={<TeacherAssignmentEditPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('Bài tập 1: Xây dựng lớp SinhVien')).toBeInTheDocument();
      });

      // Update title
      const titleInput = screen.getByLabelText(/Tiêu đề bài tập/i);
      fireEvent.change(titleInput, {
        target: { value: 'Bài tập 1: Xây dựng lớp SinhVien (Đã sửa)' },
      });

      // Save draft
      fireEvent.click(screen.getByTestId('btn-save-draft'));

      await waitFor(() => {
        expect(assignmentsService.updateAssignment).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleDetailDraft.id,
          expect.objectContaining({
            title: 'Bài tập 1: Xây dựng lớp SinhVien (Đã sửa)',
            expected_version: 1,
          }),
          expect.objectContaining({ ifMatch: 1 })
        );
      });
    });

    it('9. Uploads attachment, polls scan status, and appends clean file', async () => {
      vi.spyOn(assignmentsService, 'getTeacherAssignment').mockResolvedValue(sampleDetailDraft);
      vi.spyOn(assignmentsService, 'updateAssignment').mockResolvedValue(sampleDetailDraft);
      vi.spyOn(filesService, 'createUploadIntent').mockResolvedValue({
        file_id: 'new-clean-file-uuid',
        file_name: 'Tai-lieu-huong-dan.pdf',
        file_size: 5000,
        storage_path: 'temp/Tai-lieu-huong-dan.pdf',
        status: 'quarantine_pending',
        expires_in_seconds: 900,
        expires_at: '2026-10-28T12:00:00Z',
      });
      vi.spyOn(filesService, 'uploadContent').mockResolvedValue();
      vi.spyOn(filesService, 'commitUpload').mockResolvedValue({
        file_id: 'new-clean-file-uuid',
        file_name: 'Tai-lieu-huong-dan.pdf',
        file_size: 5000,
        status: 'scanning',
        sha256_hash: 'b'.repeat(64),
      });
      vi.spyOn(filesService, 'getFile').mockResolvedValue({
        id: 'new-clean-file-uuid',
        course_id: sampleCourse.id,
        uploader_id: 'u-1',
        uploader_name: 'Giảng viên',
        purpose: 'assignment_attachment',
        file_name: 'Tai-lieu-huong-dan.pdf',
        file_size: 5000,
        sha256_hash: 'b'.repeat(64),
        status: 'clean',
        is_published: true,
        created_at: '2026-10-28T10:00:00Z',
        updated_at: '2026-10-28T10:00:00Z',
      });

      render(
        <MemoryRouter
          initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap/soan?baiTap=${sampleDetailDraft.id}`]}
        >
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap/soan"
                element={<TeacherAssignmentEditPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Tải lên tệp tài liệu đề')).toBeInTheDocument();
      });

      // Simulate file upload
      const file = new File(['dummy-content'], 'Tai-lieu-huong-dan.pdf', { type: 'application/pdf' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).not.toBeNull();

      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: true,
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(filesService.createUploadIntent).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({
            file_name: 'Tai-lieu-huong-dan.pdf',
            purpose: 'assignment_attachment',
          })
        );
        expect(filesService.uploadContent).toHaveBeenCalled();
        expect(filesService.commitUpload).toHaveBeenCalled();
      });
      await waitFor(() => expect(screen.getByTestId('btn-save-draft')).not.toBeDisabled());
      fireEvent.click(screen.getByTestId('btn-save-draft'));
      await waitFor(() => expect(assignmentsService.updateAssignment).toHaveBeenCalledWith(
        sampleCourse.id, sampleDetailDraft.id,
        expect.objectContaining({ attachment_file_ids: expect.arrayContaining(['new-clean-file-uuid']) }),
        expect.anything(),
      ));
    });

    it('10. Detects infected file and refuses to attach to assignment', async () => {
      vi.spyOn(assignmentsService, 'getTeacherAssignment').mockResolvedValue(sampleDetailDraft);
      vi.spyOn(filesService, 'createUploadIntent').mockResolvedValue({
        file_id: 'infected-file-uuid',
        file_name: 'Trojan.exe',
        file_size: 1000,
        storage_path: 'temp/Trojan.exe',
        status: 'quarantine_pending',
        expires_in_seconds: 900,
        expires_at: '2026-10-28T12:00:00Z',
      });
      vi.spyOn(filesService, 'uploadContent').mockResolvedValue();
      vi.spyOn(filesService, 'commitUpload').mockResolvedValue({
        file_id: 'infected-file-uuid',
        file_name: 'Trojan.exe',
        file_size: 1000,
        status: 'scanning',
        sha256_hash: 'c'.repeat(64),
      });
      vi.spyOn(filesService, 'getFile').mockResolvedValue({
        id: 'infected-file-uuid',
        course_id: sampleCourse.id,
        uploader_id: 'u-1',
        uploader_name: 'Giảng viên',
        purpose: 'assignment_attachment',
        file_name: 'Trojan.exe',
        file_size: 1000,
        sha256_hash: 'c'.repeat(64),
        status: 'infected',
        is_published: false,
        created_at: '2026-10-28T10:00:00Z',
        updated_at: '2026-10-28T10:00:00Z',
      });

      render(
        <MemoryRouter
          initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap/soan?baiTap=${sampleDetailDraft.id}`]}
        >
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap/soan"
                element={<TeacherAssignmentEditPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Tải lên tệp tài liệu đề')).toBeInTheDocument();
      });

      const file = new File(['virus'], 'Trojan.exe', { type: 'application/octet-stream' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: true,
        configurable: true,
      });
      fireEvent.change(fileInput);

      await waitFor(() => {
        expect(filesService.createUploadIntent).toHaveBeenCalled();
        expect(filesService.commitUpload).toHaveBeenCalled();
        expect(filesService.getFile).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(
          screen.getAllByText(/Tệp tải lên phát hiện mã độc/i).length
        ).toBeGreaterThanOrEqual(1);
      });
    });

    it('11. Enforces post-publish lockdown: freezes title, rubric, attachments, permits due_at and allow_late', async () => {
      vi.spyOn(assignmentsService, 'getTeacherAssignment').mockResolvedValue(sampleDetailPublished);
      vi.spyOn(assignmentsService, 'updateAssignment').mockResolvedValue(sampleDetailPublished);

      render(
        <MemoryRouter
          initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap/soan?baiTap=${sampleDetailPublished.id}`]}
        >
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap/soan"
                element={<TeacherAssignmentEditPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Bài tập đã được công bố/i)).toBeInTheDocument();
      });

      // Verify title is disabled
      const titleInput = screen.getByLabelText(/Tiêu đề bài tập/i);
      expect(titleInput).toBeDisabled();

      // Verify rubric inputs are disabled
      const rubricInput = screen.getByDisplayValue('Thiết kế class và encapsulation');
      expect(rubricInput).toBeDisabled();

      // Verify due date is editable
      const dueDateInput = screen.getByLabelText(/Hạn nộp bài \(Ngày\)/i);
      expect(dueDateInput).not.toBeDisabled();

      // Save published settings
      fireEvent.click(screen.getByTestId('btn-save-published-settings'));

      await waitFor(() => {
        expect(assignmentsService.updateAssignment).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleDetailPublished.id,
          expect.objectContaining({
            expected_version: 2,
          }),
          expect.objectContaining({ ifMatch: 2 })
        );
      });
      const sent = vi.mocked(assignmentsService.updateAssignment).mock.calls.at(-1)?.[2];
      expect(new Date(sent?.due_at as string).getTime()).toBe(new Date(sampleDetailPublished.due_at).getTime());
    });

    it('12. Handles 409 Stale Version Conflict gracefully with error banner', async () => {
      vi.spyOn(assignmentsService, 'getTeacherAssignment').mockResolvedValue(sampleDetailDraft);
      vi.spyOn(assignmentsService, 'updateAssignment').mockRejectedValue(
        new ApiError(409, {
          message: 'Conflict: Version mismatch',
          details: [{ field: 'version', message: 'Stale version' }],
        })
      );

      render(
        <MemoryRouter
          initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap/soan?baiTap=${sampleDetailDraft.id}`]}
        >
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap/soan"
                element={<TeacherAssignmentEditPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('Bài tập 1: Xây dựng lớp SinhVien')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('btn-save-draft'));

      await waitFor(() => {
        expect(screen.getByText(/Xung đột phiên bản OCC/i)).toBeInTheDocument();
      });
    });

    it('13. Renders preview tab correctly under student perspective', async () => {
      vi.spyOn(assignmentsService, 'getTeacherAssignment').mockResolvedValue(sampleDetailDraft);

      render(
        <MemoryRouter
          initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/bai-tap/soan?baiTap=${sampleDetailDraft.id}`]}
        >
          <NotificationProvider>
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/bai-tap/soan"
                element={<TeacherAssignmentEditPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Xem trước như sinh viên')).toBeInTheDocument();
      });

      // Switch to preview tab
      fireEvent.click(screen.getByRole('tab', { name: /Xem trước như sinh viên/i }));

      await waitFor(() => {
        expect(
          screen.getByText('GIAO DIỆN XEM TRƯỚC (DÀNH CHO GIẢNG VIÊN KIỂM TRA ĐỀ BÀI)')
        ).toBeInTheDocument();
        expect(screen.getByText('Viết chương trình Java quản lý thông tin sinh viên với OOP')).toBeInTheDocument();
      });
    });
  });
});
