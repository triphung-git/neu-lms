import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StudentMaterialDetailPage } from '../blueprints/materials/pages/StudentMaterialDetailPage';
import { StudentMaterialSearchPage } from '../blueprints/materials/pages/StudentMaterialSearchPage';
import { StudentCourseDetailPage } from '../blueprints/courses/pages/StudentCourseDetailPage';
import { materialsService, type MaterialDetail, type MaterialListItem, type PaginatedMaterialSearchResult } from '../api/materialsService';
import { coursesService, type Course, type Chapter, type Lesson } from '../api/coursesService';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { SessionProvider } from '../app/providers/SessionContext';

// Sample mock data
const sampleCourse: Course = {
  id: 'course-uuid-001',
  code: 'MIS101',
  name: 'Hệ thống thông tin quản lý',
  term: 'HK1-2026',
  teacher: 'teacher-uuid-001',
  teacher_name: 'TS. Nguyễn Văn A',
  status: 'open',
  enrollment_open: true,
  active_member_count: 25,
  archived_at: null,
  description: 'Môn học cơ sở ngành MIS',
  created_at: '2026-09-01T08:00:00Z',
  updated_at: '2026-09-01T08:00:00Z',
};

const samplePublishedMaterial: MaterialDetail = {
  id: 'mat-uuid-101',
  course_id: sampleCourse.id,
  course_code: 'MIS101',
  title: 'Giáo trình Kiến trúc Doanh nghiệp',
  description: 'Tài liệu bắt buộc học phần MIS101',
  tags: ['enterprise', 'architecture', 'mis'],
  material_type: 'document',
  chapter: 'chap-01',
  chapter_title: 'Chương 1: Tổng quan',
  lesson: 'les-01',
  lesson_title: 'Bài 1: Giới thiệu hệ thống',
  is_hidden: false,
  visibility: 'published',
  total_versions: 2,
  created_at: '2026-09-05T09:00:00Z',
  updated_at: '2026-09-06T10:00:00Z',
  published_version: {
    id: 'ver-uuid-201',
    material_id: 'mat-uuid-101',
    material_title: 'Giáo trình Kiến trúc Doanh nghiệp',
    version_number: 1,
    title: 'Bản công bố chính thức v1',
    description: 'Tài liệu bắt buộc học phần MIS101',
    changelog: 'Cập nhật sơ đồ hệ thống',
    lifecycle_status: 'finalized',
    processing_status: 'ready',
    is_published: true,
    finalized_at: '2026-09-06T09:50:00Z',
    published_at: '2026-09-06T10:00:00Z',
    manifest_hash: 'abc123hash',
    total_size_bytes: 2048576,
    file_count: 2,
    policy_snapshot: null,
    summary: 'Tài liệu tóm tắt kiến trúc thông tin và tiêu chuẩn quản lý doanh nghiệp.',
    summary_confirmed_at: null,
    created_by_name: 'TS. Nguyễn Văn A',
    created_at: '2026-09-05T09:30:00Z',
    updated_at: '2026-09-06T10:00:00Z',
    files: [
      {
        id: 'mf-1',
        file_id: 'file-uuid-001',
        file_name: 'giao-trinh-kientruc.pdf',
        file_size: 1536000,
        mime_type: 'application/pdf',
        sha256_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        download_url: '/api/v1/courses/course-uuid-001/materials/mat-uuid-101/files/file-uuid-001/download',
        extraction_status: 'success',
        extraction_error: '',
        extraction_page_count: 1,
        preview_url: '/api/v1/courses/course-uuid-001/materials/mat-uuid-101/files/file-uuid-001/preview',
        position: 1,
        label: 'Giáo trình PDF chính',
        created_at: '2026-09-05T09:35:00Z',
      },
      {
        id: 'mf-2',
        file_id: 'file-uuid-002',
        file_name: 'de-cuong-kientruc.docx',
        file_size: 512576,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sha256_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        download_url: '/api/v1/courses/course-uuid-001/materials/mat-uuid-101/files/file-uuid-002/download',
        extraction_status: 'success',
        extraction_error: '',
        extraction_page_count: 1,
        preview_url: null, // Preview blocked by policy!
        position: 2,
        label: 'Đề cương chi tiết (Khóa xem trước)',
        created_at: '2026-09-05T09:40:00Z',
      },
    ],
  },
  latest_version: null,
};

const sampleMaterialListItems: MaterialListItem[] = [
  {
    id: 'mat-uuid-101',
    course_id: sampleCourse.id,
    course_code: 'MIS101',
    title: 'Giáo trình Kiến trúc Doanh nghiệp',
    material_type: 'document',
    chapter: 'chap-01',
    chapter_title: 'Chương 1: Tổng quan',
    lesson: 'les-01',
    lesson_title: 'Bài 1: Giới thiệu hệ thống',
    published_version_number: 1,
    latest_version_number: 1,
    is_hidden: false,
    visibility: 'published',
    file_count: 2,
    total_size_bytes: 2048576,
    tags: ['enterprise', 'architecture'],
    created_at: '2026-09-05T09:00:00Z',
    updated_at: '2026-09-06T10:00:00Z',
  },
];

const sampleSearchResults: PaginatedMaterialSearchResult = {
  items: [
    {
      id: 'mat-uuid-101',
      course_id: sampleCourse.id,
      course_code: 'MIS101',
      course_name: 'Hệ thống thông tin quản lý',
      title: 'Giáo trình Kiến trúc Doanh nghiệp',
      description: 'Tài liệu bắt buộc học phần MIS101',
      tags: ['enterprise', 'architecture'],
      material_type: 'document',
      chapter_id: 'chap-01',
      chapter_title: 'Chương 1: Tổng quan',
      lesson_id: 'les-01',
      lesson_title: 'Bài 1: Giới thiệu hệ thống',
      version_id: 'ver-uuid-201',
      version_number: 1,
      is_hidden: false,
      published_at: '2026-09-06T10:00:00Z',
      created_at: '2026-09-05T09:00:00Z',
      updated_at: '2026-09-06T10:00:00Z',
      rank: 0.95,
      matches: [
        {
          file_id: 'file-uuid-001',
          file_name: 'giao-trinh-kientruc.pdf',
          mime_type: 'application/pdf',
          page_number: 5,
          snippet: 'Khung kiến trúc doanh nghiệp TOGAF và mô hình dữ liệu quan hệ...',
          match_type: 'content',
        },
      ],
    },
  ],
  pagination: {
    page: 1,
    total_pages: 1,
    page_size: 10,
    total_items: 1,
    has_next: false,
    has_previous: false,
  },
};

describe('B09-06: Student Materials UI Integration Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('StudentMaterialDetailPage Component', () => {
    it('1.1 renders published material detail with manifest files, badges, summary and breadcrumb', async () => {
      vi.spyOn(materialsService, 'getMaterial').mockResolvedValue(samplePublishedMaterial);
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}/hoc-lieu/${samplePublishedMaterial.id}`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/sv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<StudentMaterialDetailPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      // Verify header and title
      expect(await screen.findByRole('heading', { name: 'Giáo trình Kiến trúc Doanh nghiệp' })).toBeInTheDocument();
      expect(screen.getByText('Phiên bản v1')).toBeInTheDocument();
      expect(screen.getByText('Đã công bố')).toBeInTheDocument();
      expect(screen.getByText('Đã lập chỉ mục')).toBeInTheDocument();

      // Verify confirmed summary
      expect(screen.getByText(/Tóm tắt nội dung chính đã xác nhận/i)).toBeInTheDocument();
      expect(screen.getByText(/Tài liệu tóm tắt kiến trúc thông tin/i)).toBeInTheDocument();

      // Verify manifest files
      expect(screen.getByText('Giáo trình PDF chính')).toBeInTheDocument();
      expect(screen.getByText('Đề cương chi tiết (Khóa xem trước)')).toBeInTheDocument();

      // Verify course context on right panel
      expect(screen.getByText('Chương 1: Tổng quan')).toBeInTheDocument();
      expect(screen.getAllByText('Bài 1: Giới thiệu hệ thống')).toHaveLength(2);

      // Verify honest B14 notice
      expect(screen.getByText('Trợ lý học tập AI')).toBeInTheDocument();
      expect(screen.getByText('Phân hệ B14 đang phát triển')).toBeInTheDocument();
    });

    it('1.2 enforces preview policy: blocks preview when preview_url is null', async () => {
      vi.spyOn(materialsService, 'getMaterial').mockResolvedValue(samplePublishedMaterial);
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}/hoc-lieu/${samplePublishedMaterial.id}`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/sv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<StudentMaterialDetailPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await screen.findByRole('heading', { name: 'Giáo trình Kiến trúc Doanh nghiệp' });

      // First file allows preview
      const previewButtons = screen.getAllByRole('button', { name: /Xem trực tuyến/i });
      expect(previewButtons).toHaveLength(1);

      // Second file has preview blocked badge
      expect(
        screen.getByText('Xem trước trực tuyến bị khóa bởi chính sách môn học')
      ).toBeInTheDocument();
      expect(screen.getByText('Không cho xem trước')).toBeInTheDocument();

      // Both files have download button
      const downloadButtons = screen.getAllByRole('button', { name: /Tải xuống/i });
      expect(downloadButtons).toHaveLength(2);
    });

    it('1.3 opens sandboxed preview when preview is allowed', async () => {
      vi.spyOn(materialsService, 'getMaterial').mockResolvedValue(samplePublishedMaterial);
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
      const previewSpy = vi
        .spyOn(materialsService, 'previewMaterialFile')
        .mockResolvedValue(new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }));

      // Mock URL.createObjectURL and revokeObjectURL
      const origCreate = URL.createObjectURL;
      const origRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/preview-pdf');
      URL.revokeObjectURL = vi.fn();

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}/hoc-lieu/${samplePublishedMaterial.id}`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/sv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<StudentMaterialDetailPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await screen.findByRole('heading', { name: 'Giáo trình Kiến trúc Doanh nghiệp' });

      // Click preview button
      const previewBtn = screen.getByRole('button', { name: /Xem trực tuyến/i });
      fireEvent.click(previewBtn);

      await waitFor(() => {
        expect(previewSpy).toHaveBeenCalledWith(
          sampleCourse.id,
          samplePublishedMaterial.id,
          'file-uuid-001'
        );
      });

      // Verify modal opened with iframe
      expect(await screen.findByTitle('Bản xem trước PDF')).toBeInTheDocument();

      // Cleanup mock
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    });

    it('1.4 triggers download file via materialsService.downloadMaterialFile', async () => {
      vi.spyOn(materialsService, 'getMaterial').mockResolvedValue(samplePublishedMaterial);
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
      const downloadSpy = vi
        .spyOn(materialsService, 'downloadMaterialFile')
        .mockResolvedValue(new Blob(['file content'], { type: 'application/pdf' }));

      const origCreate = URL.createObjectURL;
      const origRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/download-file');
      URL.revokeObjectURL = vi.fn();

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}/hoc-lieu/${samplePublishedMaterial.id}`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/sv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<StudentMaterialDetailPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await screen.findByRole('heading', { name: 'Giáo trình Kiến trúc Doanh nghiệp' });

      const downloadBtns = screen.getAllByRole('button', { name: /Tải xuống/i });
      fireEvent.click(downloadBtns[0]);

      await waitFor(() => {
        expect(downloadSpy).toHaveBeenCalledWith(
          sampleCourse.id,
          samplePublishedMaterial.id,
          'file-uuid-001'
        );
      });

      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    });

    it('1.5 renders access denied EmptyState when server returns 403 (withdrawn or hidden)', async () => {
      vi.spyOn(materialsService, 'getMaterial').mockRejectedValue({
        status: 403,
        message: 'Bạn không có quyền truy cập học liệu này.',
      });

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}/hoc-lieu/hidden-mat`]}>
          <NotificationProvider>
            <Routes>
              <Route
                path="/sv/mon-hoc/:monId/hoc-lieu/:hocLieuId"
                element={<StudentMaterialDetailPage />}
              />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(await screen.findByRole('heading', { name: 'Không có quyền truy cập' })).toBeInTheDocument();
      expect(
        screen.getByText(/Bạn chưa được ghi danh vào môn học này, đã rút khỏi môn học hoặc tài liệu đã bị ẩn/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Về danh sách môn học/i })).toBeInTheDocument();
    });

    it('1.6 resolves material via getMaterialById when deep linked without monId in route', async () => {
      const getByIdSpy = vi
        .spyOn(materialsService, 'getMaterialById')
        .mockResolvedValue(samplePublishedMaterial);
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);

      render(
        <MemoryRouter initialEntries={[`/sv/hoc-lieu/${samplePublishedMaterial.id}`]}>
          <NotificationProvider>
            <Routes>
              <Route path="/sv/hoc-lieu/:hocLieuId" element={<StudentMaterialDetailPage />} />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(await screen.findByRole('heading', { name: 'Giáo trình Kiến trúc Doanh nghiệp' })).toBeInTheDocument();
      expect(getByIdSpy).toHaveBeenCalledWith(samplePublishedMaterial.id);
    });
  });

  describe('StudentMaterialSearchPage Component', () => {
    it('2.1 executes server-side global search and renders results with match snippets', async () => {
      const searchSpy = vi
        .spyOn(materialsService, 'searchGlobalMaterials')
        .mockResolvedValue(sampleSearchResults);
      vi.spyOn(coursesService, 'list').mockResolvedValue({
        items: [sampleCourse],
        pagination: { page: 1, total_pages: 1, page_size: 10, total_items: 1, has_next: false, has_previous: false },
      });

      render(
        <MemoryRouter initialEntries={['/sv/tim-kiem?q=TOGAF']}>
          <NotificationProvider>
            <Routes>
              <Route path="/sv/tim-kiem" element={<StudentMaterialSearchPage />} />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(searchSpy).toHaveBeenCalledWith({
          q: 'TOGAF',
          type: undefined,
          tag: undefined,
          sort_by: 'relevance',
          page: 1,
          page_size: 10,
        });
      });

      // Verify search result card
      expect(await screen.findByText('MIS101')).toBeInTheDocument();
      expect(screen.getByText('Hệ thống thông tin quản lý')).toBeInTheDocument();
      expect(screen.getByText('Giáo trình Kiến trúc Doanh nghiệp')).toBeInTheDocument();

      // Verify provenance match snippet
      expect(screen.getByText(/Điểm khớp trong nội dung tệp đã quét/i)).toBeInTheDocument();
      expect(screen.getByText(/giao-trinh-kientruc\.pdf \(Trang 5\):/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Khung kiến trúc doanh nghiệp TOGAF và mô hình dữ liệu quan hệ\.\.\./i)
      ).toBeInTheDocument();
    });

    it('2.2 executes course-scoped search when course filter is active', async () => {
      const courseSearchSpy = vi
        .spyOn(materialsService, 'searchCourseMaterials')
        .mockResolvedValue(sampleSearchResults);
      vi.spyOn(coursesService, 'list').mockResolvedValue({
        items: [sampleCourse],
        pagination: { page: 1, total_pages: 1, page_size: 10, total_items: 1, has_next: false, has_previous: false },
      });

      render(
        <MemoryRouter initialEntries={[`/sv/tim-kiem?q=Doanh+nghi%E1%BB%87p&mon=${sampleCourse.id}`]}>
          <NotificationProvider>
            <Routes>
              <Route path="/sv/tim-kiem" element={<StudentMaterialSearchPage />} />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(courseSearchSpy).toHaveBeenCalledWith(sampleCourse.id, {
          q: 'Doanh nghiệp',
          type: undefined,
          tag: undefined,
          sort_by: 'relevance',
          page: 1,
          page_size: 10,
        });
      });

      expect(await screen.findByText('Giáo trình Kiến trúc Doanh nghiệp')).toBeInTheDocument();
    });

    it('2.3 displays empty state when search returns no matching records', async () => {
      vi.spyOn(materialsService, 'searchGlobalMaterials').mockResolvedValue({
        items: [],
        pagination: { page: 1, total_pages: 1, page_size: 10, total_items: 0, has_next: false, has_previous: false },
      });
      vi.spyOn(coursesService, 'list').mockResolvedValue({
        items: [sampleCourse],
        pagination: { page: 1, total_pages: 1, page_size: 10, total_items: 1, has_next: false, has_previous: false },
      });

      render(
        <MemoryRouter initialEntries={['/sv/tim-kiem?q=khongtontai123']}>
          <NotificationProvider>
            <Routes>
              <Route path="/sv/tim-kiem" element={<StudentMaterialSearchPage />} />
            </Routes>
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(await screen.findByText('Không tìm thấy kết quả phù hợp')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Xóa toàn bộ bộ lọc/i })).toBeInTheDocument();
    });
  });

  describe('StudentCourseDetailPage Materials Integration', () => {
    const sampleChapters: Chapter[] = [
      {
        id: 'chap-01',
        title: 'Chương 1: Tổng quan',
        position: 1,
        course: sampleCourse.id,
        created_at: '2026-09-01T08:00:00Z',
        updated_at: '2026-09-01T08:00:00Z',
      },
    ];

    const sampleLessons: Lesson[] = [
      {
        id: 'les-01',
        title: 'Bài 1: Giới thiệu hệ thống',
        description: 'Mô tả bài học 1',
        position: 1,
        chapter: 'chap-01',
        created_at: '2026-09-01T08:00:00Z',
        updated_at: '2026-09-01T08:00:00Z',
      },
    ];

    it('3.1 loads published materials and displays them in the lesson view', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
      vi.spyOn(coursesService, 'listLessons').mockResolvedValue(sampleLessons);
      vi.spyOn(materialsService, 'listMaterials').mockResolvedValue({
        items: sampleMaterialListItems,
        pagination: { page: 1, total_pages: 1, page_size: 10, total_items: 1, has_next: false, has_previous: false },
      });

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}?bai=les-01`]}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      // Verify lesson header
      expect(await screen.findByRole('heading', { name: 'Bài 1: Giới thiệu hệ thống' })).toBeInTheDocument();

      // Verify materials section
      expect(screen.getByText(/Học liệu bài học \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText('Giáo trình Kiến trúc Doanh nghiệp')).toBeInTheDocument();
      expect(screen.getByText('DOCUMENT')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Xem học liệu/i })).toBeInTheDocument();
    });

    it('3.2 displays dedicated "Học liệu" tab with material count and hub cards', async () => {
      vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
      vi.spyOn(coursesService, 'listChapters').mockResolvedValue(sampleChapters);
      vi.spyOn(coursesService, 'listLessons').mockResolvedValue(sampleLessons);
      vi.spyOn(materialsService, 'listMaterials').mockResolvedValue({
        items: sampleMaterialListItems,
        pagination: { page: 1, total_pages: 1, page_size: 10, total_items: 1, has_next: false, has_previous: false },
      });

      render(
        <MemoryRouter initialEntries={[`/sv/mon-hoc/${sampleCourse.id}?tab=hoc-lieu`]}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/sv/mon-hoc/:monId" element={<StudentCourseDetailPage />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      // Verify tab button has count
      expect(await screen.findByRole('button', { name: /Học liệu \(1\)/i })).toBeInTheDocument();

      // Verify tab content
      expect(screen.getByText('Tài liệu học tập môn học')).toBeInTheDocument();
      expect(screen.getByText('Giáo trình Kiến trúc Doanh nghiệp')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Xem chi tiết/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Tìm kiếm toàn văn môn này/i })).toBeInTheDocument();
    });
  });
});
