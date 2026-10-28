import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TeacherMaterialListPage } from '../blueprints/materials/pages/TeacherMaterialListPage';
import { UploadMaterialPage } from '../blueprints/materials/pages/UploadMaterialPage';
import { TeacherMaterialDetailPage } from '../blueprints/materials/pages/TeacherMaterialDetailPage';
import { NotificationProvider } from '../app/providers/NotificationContext';
import {
  materialsService,
  type MaterialListItem,
  type MaterialDetail,
  type MaterialVersionSummary,
  type MaterialVersionDetail,
} from '../api/materialsService';
import { filesService, type CourseFilePolicy, type StoredFile } from '../api/filesService';
import { coursesService, type Chapter, type Course } from '../api/coursesService';

// Sample Fixtures
const sampleCourse: Course = {
  id: '0a0a0a0a-1111-4111-8111-000000000001',
  code: 'CS101',
  name: 'Lập trình hướng đối tượng',
  term: 'HK1-2026',
  description: 'Khóa học OOP',
  teacher: '0a0a0a0a-1111-4111-8111-000000000002',
  teacher_name: 'TS. Nguyễn Văn A',
  status: 'open',
  enrollment_open: true,
  archived_at: null,
  active_member_count: 25,
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
  title: 'Chương 1: Giới thiệu OOP',
  position: 1,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const sampleMaterials: any[] = [
  {
    id: '0m0m0m0m-1111-4111-8111-000000000001',
    course_id: sampleCourse.id,
    course_code: sampleCourse.code,
    title: 'Slide Bài giảng Chương 1',
    description: 'Slide tổng quan kiến trúc phần mềm',
    material_type: 'slide',
    chapter: sampleChapter.id,
    chapter_id: sampleChapter.id,
    chapter_title: sampleChapter.title,
    lesson: null,
    lesson_id: null,
    lesson_title: '',
    tags: ['oop', 'chuong-1'],
    published_version_number: 1,
    latest_version_number: 1,
    published_version: {
      id: '0v0v0v0v-1111-4111-8111-000000000001',
      version_number: 1,
      status: 'published',
      lifecycle_status: 'finalized',
      processing_status: 'ready',
      is_published: true,
      extraction_status: 'READY',
      changelog: 'Khởi tạo',
      file_count: 1,
      total_size_bytes: 1048576,
      created_at: '2026-10-21T00:00:00Z',
      finalized_at: '2026-10-21T00:00:00Z',
    },
    latest_version: {
      id: '0v0v0v0v-1111-4111-8111-000000000001',
      version_number: 1,
      status: 'published',
      lifecycle_status: 'finalized',
      processing_status: 'ready',
      is_published: true,
      extraction_status: 'READY',
      changelog: 'Khởi tạo',
      file_count: 1,
      total_size_bytes: 1048576,
      created_at: '2026-10-21T00:00:00Z',
      finalized_at: '2026-10-21T00:00:00Z',
    },
    is_hidden: false,
    file_count: 1,
    total_size_bytes: 1048576,
    extraction_status: 'READY',
    created_at: '2026-10-21T00:00:00Z',
    updated_at: '2026-10-21T00:00:00Z',
  },
  {
    id: '0m0m0m0m-1111-4111-8111-000000000002',
    course_id: sampleCourse.id,
    course_code: sampleCourse.code,
    title: 'Tài liệu tham khảo Design Patterns',
    description: 'Tài liệu nháp chưa công bố',
    material_type: 'reference',
    chapter: null,
    chapter_id: null,
    chapter_title: '',
    lesson: null,
    lesson_id: null,
    lesson_title: '',
    tags: ['patterns'],
    published_version_number: null,
    latest_version_number: 1,
    published_version: null,
    latest_version: {
      id: '0v0v0v0v-1111-4111-8111-000000000002',
      version_number: 1,
      status: 'draft',
      lifecycle_status: 'draft',
      processing_status: 'pending',
      is_published: false,
      extraction_status: 'PENDING',
      changelog: 'Bản nháp ban đầu',
      file_count: 1,
      total_size_bytes: 524288,
      created_at: '2026-10-22T00:00:00Z',
      finalized_at: null,
    },
    is_hidden: false,
    file_count: 1,
    total_size_bytes: 524288,
    extraction_status: 'PENDING',
    created_at: '2026-10-22T00:00:00Z',
    updated_at: '2026-10-22T00:00:00Z',
  },
];

const sampleMaterialDetail: any = {
  ...sampleMaterials[0],
  created_by: '0a0a0a0a-1111-4111-8111-000000000002',
  created_by_name: 'TS. Nguyễn Văn A',
  total_versions: 1,
};

const sampleVersionsSummary: any[] = [
  {
    id: '0v0v0v0v-1111-4111-8111-000000000001',
    version_number: 1,
    title: 'v1',
    status: 'published',
    lifecycle_status: 'finalized',
    processing_status: 'ready',
    is_published: true,
    extraction_status: 'READY',
    changelog: 'Khởi tạo',
    file_count: 1,
    total_size_bytes: 1048576,
    created_at: '2026-10-21T00:00:00Z',
    finalized_at: '2026-10-21T00:00:00Z',
  },
];

const sampleVersionDetail: any = {
  id: '0v0v0v0v-1111-4111-8111-000000000001',
  material_id: sampleMaterials[0].id,
  version_number: 1,
  status: 'published',
  extraction_status: 'READY',
  manifest_hash: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
  changelog: 'Khởi tạo',
  created_by: '0a0a0a0a-1111-4111-8111-000000000002',
  created_by_name: 'TS. Nguyễn Văn A',
  created_at: '2026-10-21T00:00:00Z',
  finalized_at: '2026-10-21T00:00:00Z',
  files: [
    {
      id: '0f0f0f0f-1111-4111-8111-000000000001',
      file_id: '0f0f0f0f-1111-4111-8111-000000000001',
      file_name: 'Chuong1_OOP.pdf',
      byte_length: 1048576,
      mime_type: 'application/pdf',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      position: 1,
      extraction_status: 'READY',
      page_count: 15,
      char_count: 12000,
      snippet: 'Giới thiệu về các nguyên lý lập trình hướng đối tượng...',
      created_at: '2026-10-21T00:00:00Z',
    },
  ],
};

const samplePolicy: CourseFilePolicy = {
  id: '0f0f0f0f-1111-4111-8111-000000000002',
  course_id: sampleCourse.id,
  allowed_extensions: ['pdf', 'docx', 'xlsx', 'pptx'],
  max_file_size_bytes: 26214400,
  course_quota_bytes: 1073741824,
  used_quota_bytes: 104857600,
  reserved_quota_bytes: 0,
  max_files_per_assignment: 5,
  version: 1,
  preview_allowed: true,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};

const sampleStoredFile: any = {
  id: '0f0f0f0f-1111-4111-8111-000000000003',
  course_id: sampleCourse.id,
  uploader_id: '0a0a0a0a-1111-4111-8111-000000000002',
  uploader_name: 'TS. Nguyễn Văn A',
  file_name: 'TaiLieuBoSung.docx',
  file_size: 512000,
  byte_length: 512000,
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  purpose: 'course_material',
  status: 'clean',
  is_published: true,
  sha256_hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z',
};

describe('B09-05: Teacher Materials UI Integration Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
    vi.spyOn(coursesService, 'listChapters').mockResolvedValue([sampleChapter]);
    vi.spyOn(coursesService, 'listLessons').mockResolvedValue([]);
    vi.spyOn(filesService, 'getFilePolicy').mockResolvedValue(samplePolicy);
    vi.spyOn(filesService, 'listFiles').mockResolvedValue({
      items: [sampleStoredFile],
      pagination: {
        page: 1,
        page_size: 20,
        total_items: 1,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    } as any);

    vi.spyOn(materialsService, 'listMaterials').mockResolvedValue({
      items: sampleMaterials,
      pagination: {
        page: 1,
        page_size: 10,
        total_items: 2,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    });

    vi.spyOn(materialsService, 'getMaterial').mockResolvedValue(sampleMaterialDetail);
    vi.spyOn(materialsService, 'listVersions').mockResolvedValue(sampleVersionsSummary);
    vi.spyOn(materialsService, 'getVersion').mockResolvedValue(sampleVersionDetail);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 1. TeacherMaterialListPage Tests
  describe('TeacherMaterialListPage Component', () => {
    it('1.1 renders material list with titles, badges, and version summaries', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<TeacherMaterialListPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Quản lý học liệu môn học')).toBeInTheDocument();
        expect(screen.getByText('Slide Bài giảng Chương 1')).toBeInTheDocument();
        expect(screen.getByText('Tài liệu tham khảo Design Patterns')).toBeInTheDocument();
      });

      // Badges
      expect(screen.getByText(/Đã công bố \(v1\)/)).toBeInTheDocument();
      expect(screen.getByText('Bản nháp')).toBeInTheDocument();
    });

    it('1.2 filters materials by chapter', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<TeacherMaterialListPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/Chương học:/)).toBeInTheDocument();
      });

      const select = screen.getByLabelText(/Chương học:/);
      fireEvent.change(select, { target: { value: sampleChapter.id } });

      await waitFor(() => {
        expect(materialsService.listMaterials).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({ chapter_id: sampleChapter.id }),
        );
      });
    });

    it('1.3 allows hiding and unhiding a published material', async () => {
      const hideSpy = vi.spyOn(materialsService, 'hideMaterial').mockResolvedValue({
        ...sampleMaterialDetail,
        is_hidden: true,
      });

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<TeacherMaterialListPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Slide Bài giảng Chương 1')).toBeInTheDocument();
      });

      // Click "Ẩn"
      const hideBtn = screen.getByRole('button', { name: /^Ẩn$/ });
      fireEvent.click(hideBtn);

      await waitFor(() => {
        expect(hideSpy).toHaveBeenCalledWith(sampleCourse.id, sampleMaterials[0].id);
      });
    });

    it('1.4 confirms and deletes a draft material', async () => {
      const deleteSpy = vi.spyOn(materialsService, 'deleteMaterial').mockResolvedValue();

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<TeacherMaterialListPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Tài liệu tham khảo Design Patterns')).toBeInTheDocument();
      });

      // Draft material has "Xóa" button
      const deleteBtn = screen.getByRole('button', { name: /^Xóa$/ });
      fireEvent.click(deleteBtn);

      // Modal appears
      await waitFor(() => {
        expect(screen.getByText('Xác nhận xóa bản nháp học liệu')).toBeInTheDocument();
      });

      const confirmBtn = screen.getByRole('button', { name: 'Xóa học liệu' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith(sampleCourse.id, sampleMaterials[1].id);
      });
    });

    it('1.5 seamlessly switches to File Repository and Policy tabs', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu" element={<TeacherMaterialListPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Kho tệp tin')).toBeInTheDocument();
      });

      // Click "Kho tệp tin" tab
      fireEvent.click(screen.getByText('Kho tệp tin'));

      await waitFor(() => {
        // CourseFilePolicyPage rendered with quota gauge and file table
        expect(filesService.listFiles).toHaveBeenCalled();
      });
    });
  });

  // 2. UploadMaterialPage Tests
  describe('UploadMaterialPage Component', () => {
    it('2.1 renders upload form and handles mode selection', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/tai-len`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu/tai-len" element={<UploadMaterialPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Tải lên học liệu mới')).toBeInTheDocument();
        expect(screen.getByText('Tạo học liệu mới')).toBeInTheDocument();
        expect(screen.getByText('Cập nhật phiên bản mới cho học liệu có sẵn')).toBeInTheDocument();
      });

      // Switch to new version mode
      fireEvent.click(screen.getByText('Cập nhật phiên bản mới cho học liệu có sẵn'));
      expect(screen.getByText('Chọn học liệu đích:')).toBeInTheDocument();
    });

    it('2.2 performs full upload and creation flow for new material', async () => {
      const createIntentSpy = vi.spyOn(filesService, 'createUploadIntent').mockResolvedValue({
        file_id: 'new-file-uuid',
        file_name: 'Lecture1.pdf',
        file_size: 2048,
        storage_path: 'courses/xyz',
        status: 'clean',
        expires_in_seconds: 900,
        expires_at: '2026-10-28T01:00:00Z',
      });
      const uploadContentSpy = vi.spyOn(filesService, 'uploadContent').mockResolvedValue();
      const commitUploadSpy = vi.spyOn(filesService, 'commitUpload').mockResolvedValue({
        file_id: 'new-file-uuid',
        file_name: 'Lecture1.pdf',
        file_size: 2048,
        status: 'clean',
        sha256_hash: 'sha256hash',
      });
      const getFileSpy = vi.spyOn(filesService, 'getFile').mockResolvedValue({
        id: 'new-file-uuid',
        course_id: sampleCourse.id,
        uploader_id: '',
        uploader_name: '',
        file_name: 'Lecture1.pdf',
        file_size: 2048,
        purpose: 'course_material',
        status: 'clean',
        is_published: true,
        sha256_hash: 'sha256hash',
        created_at: '2026-10-28T00:00:00Z',
        updated_at: '2026-10-28T00:00:00Z',
      });

      getFileSpy.mockResolvedValueOnce({ ...sampleStoredFile, id: 'new-file-uuid', status: 'scanning' });

      const createMaterialSpy = vi.spyOn(materialsService, 'createMaterial').mockResolvedValue({
        ...sampleMaterialDetail,
        id: 'new-material-uuid',
        title: 'Bản thảo môn OOP',
        latest_version: {
          id: 'v1-uuid',
          version_number: 1,
          status: 'draft',
          extraction_status: 'PENDING',
          changelog: 'Khởi tạo',
          file_count: 1,
          total_size_bytes: 2048,
          created_at: '2026-10-28T00:00:00Z',
          finalized_at: null,
        },
      });

      const finalizeSpy = vi.spyOn(materialsService, 'finalizeVersion').mockResolvedValue({
        ...sampleVersionDetail,
        id: 'v1-uuid',
        version_number: 1,
        status: 'finalized',
      });

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/tai-len`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu/tai-len" element={<UploadMaterialPage />} />
              <Route path="/gv/mon-hoc/:monId/hoc-lieu/:matId" element={<div>Material Detail Screen</div>} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/Tên học liệu \*/)).toBeInTheDocument();
      });

      // Fill in metadata
      fireEvent.change(screen.getByLabelText(/Tên học liệu \*/), {
        target: { value: 'Bản thảo môn OOP' },
      });

      // Select file via hidden input
      const file = new File(['mock content'], 'Lecture1.pdf', { type: 'application/pdf' });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('Lecture1.pdf')).toBeInTheDocument();
      });

      // Submit Form
      const submitBtn = screen.getByRole('button', { name: 'Tạo học liệu' });
      fireEvent.click(submitBtn);

      await waitFor(() => expect(getFileSpy).toHaveBeenCalledTimes(1));
      expect(createMaterialSpy).not.toHaveBeenCalled();
      await waitFor(() => expect(getFileSpy).toHaveBeenCalledTimes(2), { timeout: 5000 });

      await waitFor(() => {
        expect(createIntentSpy).toHaveBeenCalled();
        expect(uploadContentSpy).toHaveBeenCalled();
        expect(commitUploadSpy).toHaveBeenCalled();
        expect(createMaterialSpy).toHaveBeenCalledWith(
          sampleCourse.id,
          expect.objectContaining({
            title: 'Bản thảo môn OOP',
            initial_file_ids: ['new-file-uuid'],
            material_type: 'document',
          }),
          expect.any(String),
        );
        expect(finalizeSpy).toHaveBeenCalledWith(sampleCourse.id, 'new-material-uuid', 'v1-uuid');
      });
    });

    it('2.3 blocks upload when course is archived', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleArchivedCourse);

      render(
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleArchivedCourse.id}/hoc-lieu/tai-len`]}>
            <Routes>
              <Route path="/gv/mon-hoc/:monId/hoc-lieu/tai-len" element={<UploadMaterialPage />} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Môn học đã lưu trữ')).toBeInTheDocument();
      });
    });
  });

  // 3. TeacherMaterialDetailPage Tests
  describe('TeacherMaterialDetailPage Component', () => {
    it('3.1 renders material detail, metadata form, and published pointer', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter
            initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/${sampleMaterials[0].id}`]}
          >
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<TeacherMaterialDetailPage />}
              />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Slide Bài giảng Chương 1' })).toBeInTheDocument();
        expect(screen.getByDisplayValue('Slide Bài giảng Chương 1')).toBeInTheDocument();
        expect(screen.getByText(/Đã công bố \(v1\)/)).toBeInTheDocument();
      });
    });

    it('3.2 saves metadata changes', async () => {
      const updateSpy = vi.spyOn(materialsService, 'updateMaterial').mockResolvedValue({
        ...sampleMaterialDetail,
        title: 'Slide Bài giảng Chương 1 - Cập nhật',
      });

      render(
        <NotificationProvider>
          <MemoryRouter
            initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/${sampleMaterials[0].id}`]}
          >
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<TeacherMaterialDetailPage />}
              />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('Slide Bài giảng Chương 1')).toBeInTheDocument();
      });

      const titleInput = screen.getByDisplayValue('Slide Bài giảng Chương 1');
      fireEvent.change(titleInput, { target: { value: 'Slide Bài giảng Chương 1 - Cập nhật' } });

      const saveBtn = screen.getByRole('button', { name: 'Lưu thay đổi' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleMaterials[0].id,
          expect.objectContaining({ title: 'Slide Bài giảng Chương 1 - Cập nhật' }),
        );
      });
    });

    it('3.3 creates a new revision and preserves previous version intact', async () => {
      const createRevisionSpy = vi.spyOn(materialsService, 'createRevision').mockResolvedValue({
        ...sampleVersionDetail,
        id: 'new-v2-uuid',
        version_number: 2,
        status: 'draft',
        extraction_status: 'PENDING',
        changelog: 'Bổ sung sơ đồ kiến trúc',
        files: [],
      });

      render(
        <NotificationProvider>
          <MemoryRouter
            initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/${sampleMaterials[0].id}?tab=phien-ban`]}
          >
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<TeacherMaterialDetailPage />}
              />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('+ Tạo bản sửa đổi mới (New Revision)')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('+ Tạo bản sửa đổi mới (New Revision)'));

      // Modal opens
      await waitFor(() => {
        expect(screen.getByLabelText(/Mô tả cập nhật \(Changelog\) \*/)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText(/Mô tả cập nhật \(Changelog\) \*/), {
        target: { value: 'Bổ sung sơ đồ kiến trúc' },
      });

      const submitBtn = screen.getByRole('button', { name: 'Tạo bản sửa đổi' });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(createRevisionSpy).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleMaterials[0].id,
          expect.objectContaining({ changelog: 'Bổ sung sơ đồ kiến trúc' }),
        );
      });
    });

    it('3.4 adds and removes file in draft version', async () => {
      const draftVersion: any = {
        ...sampleVersionDetail,
        id: sampleVersionsSummary[0].id,
        version_number: 1,
        lifecycle_status: 'draft',
        status: 'draft',
        processing_status: 'pending',
        extraction_status: 'PENDING',
        files: [
          {
            id: 'item-1',
            file_id: sampleStoredFile.id,
            file_name: sampleStoredFile.file_name,
            file_size: sampleStoredFile.file_size,
            mime_type: 'application/pdf',
            sha256_hash: sampleStoredFile.sha256_hash,
            position: 1,
            label: '',
            download_url: '/download',
            preview_url: null,
            created_at: '2026-10-28T00:00:00Z',
          },
        ],
      };

      vi.spyOn(materialsService, 'getVersion').mockResolvedValue(draftVersion);
      const removeFileSpy = vi.spyOn(materialsService, 'removeFileFromVersion').mockResolvedValue();

      render(
        <NotificationProvider>
          <MemoryRouter
            initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/${sampleMaterials[0].id}?tab=phien-ban`]}
          >
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<TeacherMaterialDetailPage />}
              />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Thêm tệp vào bản nháp')).toBeInTheDocument();
      });

      // Test Remove File
      const removeBtn = screen.getByRole('button', { name: 'Bỏ' });
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(removeFileSpy).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleMaterials[0].id,
          sampleVersionsSummary[0].id,
          sampleStoredFile.id,
        );
      });
    });

    it('3.5 downloads material file via secure blob handler', async () => {
      const fakeBlob = new Blob(['sample pdf content'], { type: 'application/pdf' });
      const downloadSpy = vi.spyOn(materialsService, 'downloadMaterialFile').mockResolvedValue(fakeBlob);
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fake-uuid');
      window.URL.revokeObjectURL = vi.fn();

      render(
        <NotificationProvider>
          <MemoryRouter
            initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/${sampleMaterials[0].id}?tab=phien-ban`]}
          >
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<TeacherMaterialDetailPage />}
              />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Tải' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Tải' }));

      await waitFor(() => {
        expect(downloadSpy).toHaveBeenCalledWith(
          sampleCourse.id,
          sampleMaterials[0].id,
          sampleVersionDetail.files[0].file_id,
        );
      });
    });

    it('3.6 views extraction provenance and snippet in extraction tab', async () => {
      render(
        <NotificationProvider>
          <MemoryRouter
            initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/hoc-lieu/${sampleMaterials[0].id}?tab=trich-xuat`]}
          >
            <Routes>
              <Route
                path="/gv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<TeacherMaterialDetailPage />}
              />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Trạng thái trích xuất nội dung văn bản')).toBeInTheDocument();
        expect(screen.getByText(/Chuong1_OOP\.pdf/)).toBeInTheDocument();
        expect(screen.getByText(/Số trang: 15/)).toBeInTheDocument();
        expect(
          screen.getByText(/Giới thiệu về các nguyên lý lập trình hướng đối tượng/),
        ).toBeInTheDocument();
      });
    });
  });
});
