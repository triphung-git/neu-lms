import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CourseFilePolicyPage } from '../blueprints/files/pages/CourseFilePolicyPage';
import { QuotaGaugeBar } from '../shared/ui/QuotaGaugeBar';
import { NotificationProvider } from '../app/providers/NotificationContext';
import {
  filesService,
  type CourseFilePolicy,
  type StoredFile,
  type PaginatedStoredFileList,
} from '../api/filesService';
import {
  coursesService,
  type Course,
} from '../api/coursesService';

const sampleCourse: Course = {
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
  active_member_count: 2,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const sampleArchivedCourse: Course = {
  ...sampleCourse,
  id: '0a0a0a0a-1111-4111-8111-000000000002',
  code: 'ECO201',
  name: 'Kinh tế học cơ bản',
  status: 'archived',
  enrollment_open: false,
  archived_at: '2026-05-01T00:00:00Z',
};

const samplePolicy: CourseFilePolicy = {
  id: '0f0f0f0f-1111-4111-8111-000000000001',
  course_id: sampleCourse.id,
  allowed_extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'zip'],
  max_file_size_bytes: 26214400, // 25 MB
  course_quota_bytes: 1073741824, // 1024 MB (1.0 GB)
  used_quota_bytes: 125829120, // 120 MB (12%)
  reserved_quota_bytes: 10485760, // 10 MB
  max_files_per_assignment: 5,
  version: 1,
  preview_allowed: true,
  created_at: '2026-10-27T00:00:00Z',
  updated_at: '2026-10-27T00:00:00Z',
};

const sampleFiles: StoredFile[] = [
  {
    id: '0e0e0e0e-1111-4111-8111-000000000001',
    course_id: sampleCourse.id,
    uploader_id: '0a0a0a0a-1111-4111-8111-000000000002',
    uploader_name: 'TS. Nguyễn Văn A',
    file_name: 'De-cuong-chi-tiet-mon-hoc.pdf',
    file_size: 2097152, // 2 MB
    status: 'clean',
    purpose: 'course_material',
    is_published: true,
    sha256_hash: 'a'.repeat(64),
    created_at: '2026-10-27T01:00:00Z',
    updated_at: '2026-10-27T01:00:00Z',
  },
  {
    id: '0e0e0e0e-1111-4111-8111-000000000002',
    course_id: sampleCourse.id,
    uploader_id: '0a0a0a0a-1111-4111-8111-000000000002',
    uploader_name: 'TS. Nguyễn Văn A',
    file_name: 'Bai-giang-chuong-1.pptx',
    file_size: 15728640, // 15 MB
    status: 'clean',
    purpose: 'course_material',
    is_published: false,
    sha256_hash: 'b'.repeat(64),
    created_at: '2026-10-27T02:00:00Z',
    updated_at: '2026-10-27T02:00:00Z',
  },
  {
    id: '0e0e0e0e-1111-4111-8111-000000000003',
    course_id: sampleCourse.id,
    uploader_id: '0c0c0c0c-1111-4111-8111-000000000001',
    uploader_name: 'Trần Thị Mai',
    file_name: 'Bai-tap-lon.zip',
    file_size: 5242880, // 5 MB
    status: 'scanning',
    purpose: 'assignment_submission',
    is_published: false,
    sha256_hash: 'c'.repeat(64),
    created_at: '2026-10-27T03:00:00Z',
    updated_at: '2026-10-27T03:00:00Z',
  },
  {
    id: '0e0e0e0e-1111-4111-8111-000000000004',
    course_id: sampleCourse.id,
    uploader_id: '0c0c0c0c-1111-4111-8111-000000000002',
    uploader_name: 'Lê Hoàng Nam',
    file_name: 'Virus-Sample.exe',
    file_size: 1048576, // 1 MB
    status: 'infected',
    purpose: 'assignment_submission',
    is_published: false,
    sha256_hash: 'd'.repeat(64),
    created_at: '2026-10-27T04:00:00Z',
    updated_at: '2026-10-27T04:00:00Z',
  },
];

const paginatedFiles: PaginatedStoredFileList = {
  pagination: { page: 1, total_pages: 1, total_items: sampleFiles.length },
      items: sampleFiles,
};

const renderWithProviders = (initialRoute = `/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`) => {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<CourseFilePolicyPage />} />
          <Route path="/gv/mon-hoc/:monId/chinh-sach-tep" element={<CourseFilePolicyPage initialTab="policy" />} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>,
  );
};

describe('B08-05: UI Giảng viên - Cấu hình Policy & Kho Tệp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
    vi.spyOn(filesService, 'getFilePolicy').mockResolvedValue(samplePolicy);
    vi.spyOn(filesService, 'listFiles').mockResolvedValue(paginatedFiles);
    vi.spyOn(filesService, 'updateFilePolicy').mockImplementation(async (_, data) => ({
      ...samplePolicy,
      ...data,
      max_file_size_bytes: (data.max_file_size_bytes as number) || samplePolicy.max_file_size_bytes,
      course_quota_bytes: (data.course_quota_bytes as number) || samplePolicy.course_quota_bytes,
    }));
    vi.spyOn(filesService, 'updatePublish').mockImplementation(async (_, fileId, isPublished) => {
      const target = sampleFiles.find((f) => f.id === fileId);
      return { ...target!, is_published: isPublished };
    });
    vi.spyOn(filesService, 'deleteFile').mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('1. QuotaGaugeBar Component', () => {
    it('renders normal quota status, used/total ratio, and percentage badge correctly', () => {
      render(
        <QuotaGaugeBar
          usedBytes={125829120} // 120 MB
          totalBytes={1073741824} // 1.0 GB
          reservedBytes={10485760} // 10 MB
        />,
      );

      const gauge = screen.getByTestId('quota-gauge-bar');
      expect(gauge).toHaveClass('gauge-normal');
      expect(screen.getByText('12%')).toBeInTheDocument();
      expect(screen.getByTestId('quota-gauge-numbers')).toHaveTextContent(/120.*MB/);
      expect(screen.getByTestId('quota-gauge-numbers')).toHaveTextContent(/1.*GB/);
      expect(screen.getByTestId('quota-progress-reserved')).toBeInTheDocument();
    });

    it('renders danger class when quota exceeds 90%', () => {
      render(
        <QuotaGaugeBar
          usedBytes={1024 * 1024 * 950} // 950 MB / 1024 MB = 93%
          totalBytes={1073741824}
        />,
      );

      const gauge = screen.getByTestId('quota-gauge-bar');
      expect(gauge).toHaveClass('gauge-danger');
      expect(screen.getByText('93%')).toBeInTheDocument();
    });
  });

  describe('2. Navigation and Policy Tab Loading', () => {
    it('renders header, quota summary, tabs and file repository initially', async () => {
      renderWithProviders();

      expect(await screen.findByTestId('course-file-policy-page')).toBeInTheDocument();
      expect(screen.getByText('Quản lý Kho Tệp & Chính Sách Môn Học')).toBeInTheDocument();
      expect(screen.getByTestId('tab-files')).toHaveClass('active');
      expect(screen.getByTestId('files-table')).toBeInTheDocument();
      expect(screen.getByText('De-cuong-chi-tiet-mon-hoc.pdf')).toBeInTheDocument();
    });

    it('switches to policy configuration tab and populates inputs from server policy', async () => {
      renderWithProviders();

      const policyTabBtn = await screen.findByTestId('tab-policy');
      fireEvent.click(policyTabBtn);

      expect(await screen.findByTestId('policy-form-section')).toBeInTheDocument();
      expect(await screen.findByLabelText('Kích thước tối đa 1 tệp (MB) *')).toHaveValue(25);
      expect(screen.getByLabelText('Dung lượng tối đa môn học (MB) *')).toHaveValue(1024);
      expect(screen.getByLabelText('Số tệp tối đa mỗi lần nộp *')).toHaveValue(5);
      expect(screen.getByTestId('preview-allowed-toggle')).toBeChecked();
    });
  });

  describe('3. Policy Update and Validation', () => {
    it('updates policy successfully when valid values are submitted', async () => {
      renderWithProviders();

      const policyTabBtn = await screen.findByTestId('tab-policy');
      fireEvent.click(policyTabBtn);

      const maxFileSizeInput = await screen.findByLabelText('Kích thước tối đa 1 tệp (MB) *');
      fireEvent.change(maxFileSizeInput, { target: { value: '30' } });

      const saveBtn = screen.getByTestId('save-policy-btn');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(filesService.updateFilePolicy).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({
            max_file_size_bytes: 30 * 1024 * 1024,
            max_files_per_assignment: 5,
            preview_allowed: true,
          }),
        );
      });
    });

    it('displays error and halts submission when max file size exceeds system ceiling of 50MB', async () => {
      renderWithProviders();

      const policyTabBtn = await screen.findByTestId('tab-policy');
      fireEvent.click(policyTabBtn);

      const maxFileSizeInput = await screen.findByLabelText('Kích thước tối đa 1 tệp (MB) *');
      fireEvent.change(maxFileSizeInput, { target: { value: '60' } });

      const saveBtn = screen.getByTestId('save-policy-btn');
      fireEvent.click(saveBtn);

      expect(
        await screen.findByText('Kích thước tối đa không được vượt quá trần hệ thống 50MB.'),
      ).toBeInTheDocument();
      expect(filesService.updateFilePolicy).not.toHaveBeenCalled();
    });

    it('displays error when course quota exceeds system ceiling of 5120MB', async () => {
      renderWithProviders();

      const policyTabBtn = await screen.findByTestId('tab-policy');
      fireEvent.click(policyTabBtn);

      const quotaInput = await screen.findByLabelText('Dung lượng tối đa môn học (MB) *');
      fireEvent.change(quotaInput, { target: { value: '6000' } });

      const saveBtn = screen.getByTestId('save-policy-btn');
      fireEvent.click(saveBtn);

      expect(
        await screen.findByText('Dung lượng môn học không được vượt quá trần hệ thống 5,0 GB (5120 MB).'),
      ).toBeInTheDocument();
      expect(filesService.updateFilePolicy).not.toHaveBeenCalled();
    });
  });

  describe('4. Archived Course Read-Only Behavior', () => {
    it('locks all inputs and actions in read-only mode when course is archived', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleArchivedCourse);

      renderWithProviders(`/gv/mon-hoc/${sampleArchivedCourse.id}/chinh-sach-tep`);

      expect(await screen.findByTestId('archived-warning-banner')).toBeInTheDocument();

      // Form inputs must be disabled
      expect(screen.getByLabelText('Kích thước tối đa 1 tệp (MB) *')).toBeDisabled();
      expect(screen.getByLabelText('Dung lượng tối đa môn học (MB) *')).toBeDisabled();
      expect(screen.getByLabelText('Số tệp tối đa mỗi lần nộp *')).toBeDisabled();
      expect(screen.getByTestId('preview-allowed-toggle')).toBeDisabled();
      expect(screen.getByTestId('save-policy-btn')).toBeDisabled();

      // Switch to files tab
      fireEvent.click(screen.getByTestId('tab-files'));

      // Delete buttons must be disabled
      const deleteButtons = screen.getAllByTitle('Môn học đã lưu trữ');
      expect(deleteButtons.length).toBeGreaterThan(0);
      deleteButtons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });
  });

  describe('5. Files Repository Actions', () => {
    it('displays malware scan statuses with accurate security badges', async () => {
      renderWithProviders();

      const cleanBadges = await screen.findAllByText('An toàn');
      expect(cleanBadges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Đang quét')).toBeInTheDocument();
      expect(screen.getByText('Nhiễm mã độc')).toBeInTheDocument();

      // Download button disabled for infected / scanning files
      const cleanDownload = screen.getByTestId(`download-btn-${sampleFiles[0].id}`);
      expect(cleanDownload).toHaveAttribute('href');

      const infectedRow = screen.getByTestId(`file-row-${sampleFiles[3].id}`);
      const disabledDownload = infectedRow.querySelector('.btn-action-icon.disabled');
      expect(disabledDownload).toBeInTheDocument();
    });

    it('toggles course material publish status via filesService.updatePublish', async () => {
      renderWithProviders();

      // sampleFiles[1] is unpublished course material
      const publishBtn = await screen.findByTestId(`publish-btn-${sampleFiles[1].id}`);
      expect(publishBtn).toHaveTextContent('Bản nháp');

      fireEvent.click(publishBtn);

      await waitFor(() => {
        expect(filesService.updatePublish).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleFiles[1].id,
          true,
        );
      });
    });

    it('opens confirmation modal and deletes file, updating quota and file list', async () => {
      renderWithProviders();

      const deleteBtn = await screen.findByTestId(`delete-btn-${sampleFiles[0].id}`);
      fireEvent.click(deleteBtn);

      expect(screen.getByText('Xác nhận xóa tệp tin')).toBeInTheDocument();
      expect(screen.getByText(/Bạn có chắc chắn muốn xóa tệp tin/)).toBeInTheDocument();

      const confirmDeleteBtn = screen.getByTestId('confirm-delete-btn');
      fireEvent.click(confirmDeleteBtn);

      await waitFor(() => {
        expect(filesService.deleteFile).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleFiles[0].id,
        );
      });
    });
  });
});
