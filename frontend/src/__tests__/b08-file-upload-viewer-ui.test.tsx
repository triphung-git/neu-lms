import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SecureFileUploader,
  type SecureFileUploaderProps,
} from '../blueprints/files/components/SecureFileUploader';
import {
  SecureFileViewer,
  type SecureFileViewerProps,
} from '../blueprints/files/components/SecureFileViewer';
import { CourseFilePolicyPage } from '../blueprints/files/pages/CourseFilePolicyPage';
import {
  filesService,
  type CourseFilePolicy,
  type StoredFile,
  type PaginatedStoredFileList,
} from '../api/filesService';
import { coursesService, type Course } from '../api/coursesService';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../blueprints/files/components/PdfPreview', () => ({
  PdfPreview: ({ url }: { url: string }) => <div data-testid="secure-pdf-preview" data-url={url} />,
}));

const sampleCourse: Course = {
  id: '0a0a0a0a-1111-4111-8111-000000000001',
  code: 'CS101',
  name: 'Nhập môn Lập trình',
  term: 'Học kỳ 1 - 2026',
  description: 'Môn học cơ sở lập trình',
  teacher: '0a0a0a0a-1111-4111-8111-000000000002',
  teacher_name: 'TS. Nguyễn Văn A',
  status: 'open',
  enrollment_open: true,
  archived_at: null,
  active_member_count: 20,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const samplePolicy: CourseFilePolicy = {
  id: '0f0f0f0f-1111-4111-8111-000000000001',
  course_id: sampleCourse.id,
  allowed_extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'zip', 'png', 'jpg'],
  max_file_size_bytes: 26214400, // 25 MB
  course_quota_bytes: 1073741824, // 1024 MB (1.0 GB)
  used_quota_bytes: 125829120, // 120 MB
  reserved_quota_bytes: 10485760, // 10 MB
  max_files_per_assignment: 5,
  version: 1,
  preview_allowed: true,
  created_at: '2026-10-27T00:00:00Z',
  updated_at: '2026-10-27T00:00:00Z',
};

const sampleCleanPdf: StoredFile = {
  id: '0e0e0e0e-1111-4111-8111-000000000001',
  course_id: sampleCourse.id,
  uploader_id: '0a0a0a0a-1111-4111-8111-000000000002',
  uploader_name: 'TS. Nguyễn Văn A',
  file_name: 'Giao-trinh-CS101.pdf',
  file_size: 5242880, // 5 MB
  status: 'clean',
  purpose: 'course_material',
  is_published: true,
  sha256_hash: 'a'.repeat(64),
  created_at: '2026-10-27T01:00:00Z',
  updated_at: '2026-10-27T01:00:00Z',
};

const sampleCleanImage: StoredFile = {
  id: '0e0e0e0e-1111-4111-8111-000000000002',
  course_id: sampleCourse.id,
  uploader_id: '0a0a0a0a-1111-4111-8111-000000000002',
  uploader_name: 'TS. Nguyễn Văn A',
  file_name: 'So-do-kien-truc.png',
  file_size: 1048576, // 1 MB
  status: 'clean',
  purpose: 'course_material',
  is_published: true,
  sha256_hash: 'b'.repeat(64),
  created_at: '2026-10-27T02:00:00Z',
  updated_at: '2026-10-27T02:00:00Z',
};

const sampleCleanDocx: StoredFile = {
  id: '0e0e0e0e-1111-4111-8111-000000000003',
  course_id: sampleCourse.id,
  uploader_id: '0a0a0a0a-1111-4111-8111-000000000002',
  uploader_name: 'TS. Nguyễn Văn A',
  file_name: 'Mau-de-cuong.docx',
  file_size: 2097152, // 2 MB
  status: 'clean',
  purpose: 'course_material',
  is_published: true,
  sha256_hash: 'c'.repeat(64),
  created_at: '2026-10-27T03:00:00Z',
  updated_at: '2026-10-27T03:00:00Z',
};

const sampleInfectedFile: StoredFile = {
  id: '0e0e0e0e-1111-4111-8111-000000000004',
  course_id: sampleCourse.id,
  uploader_id: '0a0a0a0a-1111-4111-8111-000000000003',
  uploader_name: 'Sinh viên B',
  file_name: 'Malware-EICAR.pdf',
  file_size: 68,
  status: 'infected',
  purpose: 'assignment_submission',
  is_published: false,
  sha256_hash: 'd'.repeat(64),
  created_at: '2026-10-27T04:00:00Z',
  updated_at: '2026-10-27T04:00:00Z',
};

describe('B08-06: UI Tích Hợp Upload, Quarantine Progress & Secure File Viewer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(filesService, 'uploadContent').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ==========================================================================
     1. SecureFileUploader Tests
     ========================================================================== */
  describe('1. SecureFileUploader Component', () => {
    it('renders dropzone with allowed extensions and size limit info', () => {
      render(
        <SecureFileUploader
          courseId={sampleCourse.id}
          policy={samplePolicy}
        />,
      );

      expect(screen.getByTestId('file-dropzone')).toBeInTheDocument();
      expect(screen.getByText(/Kéo thả tệp vào đây hoặc nhấn để duyệt/)).toBeInTheDocument();
      expect(screen.getByText(/\.PDF/)).toBeInTheDocument();
      expect(screen.getByText(/25,0 MB/)).toBeInTheDocument();
    });

    it('rejects file with disallowed extension before creating intent (Client-side validation)', async () => {
      const onUploadError = vi.fn();
      const createIntentSpy = vi.spyOn(filesService, 'createUploadIntent');

      render(
        <SecureFileUploader
          courseId={sampleCourse.id}
          policy={samplePolicy}
          onUploadError={onUploadError}
        />,
      );

      const disallowedFile = new File(['binary content'], 'virus.exe', {
        type: 'application/x-msdownload',
      });

      const dropzone = screen.getByTestId('file-dropzone');
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [disallowedFile] },
      });

      expect(
        await screen.findByText(/Định dạng tệp "\.exe" không được phép/),
      ).toBeInTheDocument();
      expect(createIntentSpy).not.toHaveBeenCalled();
      expect(onUploadError).toHaveBeenCalledWith(
        expect.stringContaining('không được phép'),
      );
    });

    it('rejects file exceeding max_file_size_bytes before creating intent', async () => {
      const onUploadError = vi.fn();
      const createIntentSpy = vi.spyOn(filesService, 'createUploadIntent');

      render(
        <SecureFileUploader
          courseId={sampleCourse.id}
          policy={samplePolicy} // max 25 MB
          onUploadError={onUploadError}
        />,
      );

      // Create dummy file with 30 MB size property
      const hugeFile = new File(['content'], 'big-document.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(hugeFile, 'size', { value: 31457280 }); // 30 MB

      const dropzone = screen.getByTestId('file-dropzone');
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [hugeFile] },
      });

      expect(
        await screen.findByText(/vượt quá giới hạn cho phép của môn học/),
      ).toBeInTheDocument();
      expect(createIntentSpy).not.toHaveBeenCalled();
      expect(onUploadError).toHaveBeenCalledWith(
        expect.stringContaining('vượt quá giới hạn'),
      );
    });

    it('rejects file when course remaining quota is insufficient', async () => {
      const tightPolicy: CourseFilePolicy = {
        ...samplePolicy,
        course_quota_bytes: 104857600, // 100 MB
        used_quota_bytes: 99614720, // 95 MB
        reserved_quota_bytes: 0,
        max_file_size_bytes: 26214400, // 25 MB
      };

      render(
        <SecureFileUploader
          courseId={sampleCourse.id}
          policy={tightPolicy}
        />,
      );

      // Try uploading a 10 MB file when only 5 MB remaining
      const file = new File(['content'], 'document.pdf', { type: 'application/pdf' });
      Object.defineProperty(file, 'size', { value: 10485760 }); // 10 MB

      const dropzone = screen.getByTestId('file-dropzone');
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file] },
      });

      expect(
        await screen.findByText(/Dung lượng còn lại của môn học không đủ/),
      ).toBeInTheDocument();
    });

    it('locks dropzone and prevents upload when course is archived', () => {
      const createIntentSpy = vi.spyOn(filesService, 'createUploadIntent');

      render(
        <SecureFileUploader
          courseId={sampleCourse.id}
          policy={samplePolicy}
          isArchived={true}
        />,
      );

      expect(
        screen.getByText('Môn học đã lưu trữ — Không thể tải lên tệp'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Chọn tệp từ máy')).not.toBeInTheDocument();

      const dropzone = screen.getByTestId('file-dropzone');
      const file = new File(['content'], 'document.pdf', { type: 'application/pdf' });
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file] },
      });

      expect(createIntentSpy).not.toHaveBeenCalled();
    });

    it('executes full 2-phase upload flow, shows quarantine scanning progress, and finishes clean', async () => {
      const onUploadSuccess = vi.fn();
      const validFile = new File(['test pdf content'], 'lecture-1.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(validFile, 'size', { value: 1048576 }); // 1 MB

      vi.spyOn(filesService, 'createUploadIntent').mockResolvedValue({
        file_id: 'file-uuid-001',
        file_name: 'lecture-1.pdf',
        file_size: 1048576,
        storage_path: 'quarantine/file-uuid-001.pdf',
        status: 'scanning',
        purpose: 'course_material',
        expires_in_seconds: 900,
        expires_at: '2026-10-27T02:00:00Z',
      });

      vi.spyOn(filesService, 'commitUpload').mockResolvedValue({
        file_id: 'file-uuid-001',
        file_name: 'lecture-1.pdf',
        file_size: 1048576,
        status: 'scanning',
        sha256_hash: 'a'.repeat(64),
      });

      // Mock getFile returning clean file on first poll
      vi.spyOn(filesService, 'getFile').mockResolvedValue({
        ...sampleCleanPdf,
        id: 'file-uuid-001',
        file_name: 'lecture-1.pdf',
        status: 'clean',
      });

      render(
        <SecureFileUploader
          courseId={sampleCourse.id}
          policy={samplePolicy}
          onUploadSuccess={onUploadSuccess}
        />,
      );

      const dropzone = screen.getByTestId('file-dropzone');
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [validFile] },
      });

      // Shows upload card and file name
      expect(await screen.findByText('lecture-1.pdf')).toBeInTheDocument();

      // Verifies intent created with correct params
      await waitFor(() => {
        expect(filesService.createUploadIntent).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({
            file_name: 'lecture-1.pdf',
            file_size: 1048576,
            purpose: 'course_material',
          }),
        );
      });

      expect(filesService.uploadContent).toHaveBeenCalledWith(sampleCourse.id, 'file-uuid-001', validFile);

      // Verifies commit called
      await waitFor(() => {
        expect(filesService.commitUpload).toHaveBeenCalledWith(
          sampleCourse.id,
          'file-uuid-001',
          expect.objectContaining({ client_checksum: expect.any(String) }),
        );
      });

      // Verifies quarantine scan success state
      expect(
        await screen.findByText('Tải lên & Quét an toàn thành công!'),
      ).toBeInTheDocument();
      expect(screen.getByText(/file-uuid-001/)).toBeInTheDocument();
      expect(onUploadSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'file-uuid-001', status: 'clean' }),
      );
    });

    it('displays prominent danger alert when scanner detects infected malware file', async () => {
      const onUploadError = vi.fn();
      const infectedFile = new File(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'], 'eicar.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(infectedFile, 'size', { value: 68 });

      vi.spyOn(filesService, 'createUploadIntent').mockResolvedValue({
        file_id: 'virus-uuid-001',
        file_name: 'eicar.pdf',
        file_size: 68,
        storage_path: 'quarantine/virus-uuid-001.pdf',
        status: 'scanning',
        purpose: 'assignment_submission',
        expires_in_seconds: 900,
        expires_at: '2026-10-27T02:00:00Z',
      });

      vi.spyOn(filesService, 'commitUpload').mockResolvedValue({
        file_id: 'virus-uuid-001',
        file_name: 'eicar.pdf',
        file_size: 68,
        status: 'scanning',
        sha256_hash: 'd'.repeat(64),
      });

      // Mock getFile returning infected file
      vi.spyOn(filesService, 'getFile').mockResolvedValue({
        ...sampleInfectedFile,
        id: 'virus-uuid-001',
        status: 'infected',
      });

      render(
        <SecureFileUploader
          courseId={sampleCourse.id}
          policy={samplePolicy}
          purpose="assignment_submission"
          onUploadError={onUploadError}
        />,
      );

      const dropzone = screen.getByTestId('file-dropzone');
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [infectedFile] },
      });

      expect(await screen.findByText('PHÁT HIỆN MÃ ĐỘC NGUY HẠI!')).toBeInTheDocument();
      expect(
        screen.getByText(/Tệp tin bị phát hiện chứa mã độc/),
      ).toBeInTheDocument();
      expect(screen.getByTestId('dismiss-infected-btn')).toBeInTheDocument();
      expect(onUploadError).toHaveBeenCalledWith(
        expect.stringContaining('CẢNH BÁO AN NINH'),
      );
    });
  });

  /* ==========================================================================
     2. SecureFileViewer Tests
     ========================================================================== */
  describe('2. SecureFileViewer Component (Modal Preview & Security Sandbox)', () => {
    it('does not render when isOpen is false', () => {
      render(
        <SecureFileViewer
          courseId={sampleCourse.id}
          file={sampleCleanPdf}
          policy={samplePolicy}
          isOpen={false}
          onClose={vi.fn()}
        />,
      );

      expect(screen.queryByTestId('secure-file-viewer-modal')).not.toBeInTheDocument();
    });

    it('renders canvas viewer when preview_allowed is true for PDF', () => {
      render(
        <SecureFileViewer
          courseId={sampleCourse.id}
          file={sampleCleanPdf}
          policy={samplePolicy}
          isOpen={true}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByTestId('secure-file-viewer-modal')).toBeInTheDocument();
      expect(screen.getByText('Giao-trinh-CS101.pdf')).toBeInTheDocument();
      expect(screen.getByText('5,0 MB')).toBeInTheDocument();
      expect(screen.getByText('An toàn')).toBeInTheDocument();

      // Check download button
      const downloadBtn = screen.getByTestId('viewer-download-btn');
      expect(downloadBtn).toHaveAttribute(
        'href',
        filesService.getDownloadUrl(sampleCourse.id, sampleCleanPdf.id),
      );

      // The viewer receives the authenticated preview endpoint; no embedded document executes.
      const preview = screen.getByTestId('secure-pdf-preview');
      expect(preview).toHaveAttribute(
        'data-url',
        filesService.getPreviewUrl(sampleCourse.id, sampleCleanPdf.id),
      );
      expect(document.querySelector('iframe')).toBeNull();
    });

    it('renders image element when preview_allowed is true for image files', () => {
      render(
        <SecureFileViewer
          courseId={sampleCourse.id}
          file={sampleCleanImage}
          policy={samplePolicy}
          isOpen={true}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByTestId('image-preview-container')).toBeInTheDocument();
      const img = screen.getByTestId('secure-preview-image');
      expect(img).toHaveAttribute(
        'src',
        filesService.getPreviewUrl(sampleCourse.id, sampleCleanImage.id),
      );
      expect(img).toHaveAttribute('alt', 'So-do-kien-truc.png');
    });

    it('renders blocked notice and download fallback when preview_allowed is false', () => {
      const disabledPreviewPolicy: CourseFilePolicy = {
        ...samplePolicy,
        version: 1,
  preview_allowed: false,
      };

      render(
        <SecureFileViewer
          courseId={sampleCourse.id}
          file={sampleCleanPdf}
          policy={disabledPreviewPolicy}
          isOpen={true}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByTestId('preview-blocked-notice')).toBeInTheDocument();
      expect(screen.getByText('Xem trước bị vô hiệu hóa')).toBeInTheDocument();
      expect(
        screen.getByText(/Tệp này không hỗ trợ xem trước theo quy định của môn học/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('secure-pdf-preview')).not.toBeInTheDocument();

      const downloadFallback = screen.getByTestId('download-fallback-btn');
      expect(downloadFallback).toHaveAttribute(
        'href',
        filesService.getDownloadUrl(sampleCourse.id, sampleCleanPdf.id),
      );
    });

    it('renders unsupported notice for non-previewable formats (DOCX/ZIP)', () => {
      render(
        <SecureFileViewer
          courseId={sampleCourse.id}
          file={sampleCleanDocx}
          policy={samplePolicy}
          isOpen={true}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByTestId('unsupported-preview-notice')).toBeInTheDocument();
      expect(screen.getByText('Không hỗ trợ xem trực tiếp')).toBeInTheDocument();
      expect(screen.getByText(/\.DOCX/)).toBeInTheDocument();
      expect(screen.getByTestId('download-unsupported-btn')).toBeInTheDocument();
    });

    it('blocks preview and download when file is not clean (e.g. infected/scanning)', () => {
      render(
        <SecureFileViewer
          courseId={sampleCourse.id}
          file={sampleInfectedFile}
          policy={samplePolicy}
          isOpen={true}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByTestId('preview-unsafe-alert')).toBeInTheDocument();
      expect(screen.getByText('Không thể xem trước tệp')).toBeInTheDocument();
      expect(screen.queryByTestId('viewer-download-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('secure-pdf-preview')).not.toBeInTheDocument();
    });

    it('calls onClose when close button or Escape key is pressed', () => {
      const onClose = vi.fn();

      render(
        <SecureFileViewer
          courseId={sampleCourse.id}
          file={sampleCleanPdf}
          policy={samplePolicy}
          isOpen={true}
          onClose={onClose}
        />,
      );

      const closeBtn = screen.getByTestId('viewer-close-btn');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  /* ==========================================================================
     3. Integration in CourseFilePolicyPage
     ========================================================================== */
  describe('3. Integration in CourseFilePolicyPage', () => {
    const paginatedFiles: PaginatedStoredFileList = {
      pagination: { page: 1, total_pages: 1, total_items: 2 },
      items: [sampleCleanPdf, sampleCleanImage],
    };

    beforeEach(() => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
      vi.spyOn(filesService, 'getFilePolicy').mockResolvedValue(samplePolicy);
      vi.spyOn(filesService, 'listFiles').mockResolvedValue(paginatedFiles);
    });

    it('toggles uploader section when clicking "Tải tệp lên" button', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<CourseFilePolicyPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      // Initial state: uploader is closed
      expect(screen.queryByTestId('uploader-embed-section')).not.toBeInTheDocument();

      const toggleBtn = await screen.findByTestId('toggle-uploader-btn');
      expect(toggleBtn).toHaveTextContent('Tải tệp lên');

      // Click to open uploader
      fireEvent.click(toggleBtn);
      expect(await screen.findByTestId('uploader-embed-section')).toBeInTheDocument();
      expect(toggleBtn).toHaveTextContent('Đóng tải tệp');

      // Click again to close uploader
      fireEvent.click(toggleBtn);
      expect(screen.queryByTestId('uploader-embed-section')).not.toBeInTheDocument();
    });

    it('opens SecureFileViewer modal when clicking preview button on clean file row', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<CourseFilePolicyPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      // Wait for table to load
      const previewBtn = await screen.findByTestId(`preview-btn-${sampleCleanPdf.id}`);
      fireEvent.click(previewBtn);

      // SecureFileViewer modal should open
      expect(await screen.findByTestId('secure-file-viewer-modal')).toBeInTheDocument();
      expect(screen.getByTestId('secure-pdf-preview')).toBeInTheDocument();
    });
  });
  it('never reports a successful scan when polling times out', async () => {
    vi.useFakeTimers();
    try {
      const onSuccess = vi.fn();
      vi.spyOn(filesService, 'createUploadIntent').mockResolvedValue({ file_id: 'pending-id', file_name: 'pending.pdf', file_size: 10, storage_path: 'q/pending', status: 'quarantine_pending', expires_in_seconds: 900, expires_at: '2026-10-27T00:15:00Z' });
      vi.spyOn(filesService, 'commitUpload').mockResolvedValue({ file_id: 'pending-id', file_name: 'pending.pdf', file_size: 10, status: 'scanning', sha256_hash: 'a'.repeat(64) });
      const getFile = vi.spyOn(filesService, 'getFile').mockResolvedValue({ ...sampleCleanPdf, id: 'pending-id', status: 'scanning' });
      const pendingFile = new File(['%PDF-test'], 'pending.pdf', { type: 'application/pdf' });
      // This case tests polling, not native File/WebCrypto I/O, which fake timers cannot flush.
      // Client hashing is optional: the server always computes the authoritative checksum.
      Object.defineProperty(pendingFile, 'arrayBuffer', {
        value: vi.fn().mockRejectedValue(new Error('Client hashing unavailable')),
      });
      render(<SecureFileUploader courseId={sampleCourse.id} policy={samplePolicy} onUploadSuccess={onSuccess} />);
      await act(async () => { fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [pendingFile] } }); });
      expect(filesService.commitUpload).toHaveBeenCalledWith(sampleCourse.id, 'pending-id', { client_checksum: '' });
      expect(getFile).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(35000); });
      expect(getFile).toHaveBeenCalledTimes(20);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(screen.getByText('Quét chưa hoàn tất. Kiểm tra lại trong kho tệp.')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

});
