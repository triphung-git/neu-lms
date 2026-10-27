import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { AdminCoursesPage } from '../blueprints/courses/pages/AdminCoursesPage';
import { CreateCoursePage } from '../blueprints/courses/pages/CreateCoursePage';
import { CourseStructurePage } from '../blueprints/courses/pages/CourseStructurePage';
import { CourseTeacherLayout } from '../app/layouts/CourseTeacherLayout';
import { TeacherCoursesPage } from '../blueprints/courses/pages/TeacherCoursesPage';
import { coursesService, type Chapter, type Course } from '../api/coursesService';

const sampleCourse: Course = {
  id: '0a0a0a0a-1111-4111-8111-000000000001',
  code: 'WEB202',
  name: 'Lập trình Web',
  term: 'HK1-2026',
  description: 'Môn học kiểm thử',
  teacher: '0a0a0a0a-1111-4111-8111-000000000002',
  teacher_name: 'Giảng viên Một',
  status: 'open',
  enrollment_open: false,
  archived_at: null,
  active_member_count: 5,
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
};

const sampleChapter: Chapter = {
  id: '0a0a0a0a-1111-4111-8111-000000000003',
  course: sampleCourse.id,
  title: 'Chương kiểm thử',
  position: 1,
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
};

const paginatedCourses = {
  items: [sampleCourse],
  pagination: {
    page: 1,
    page_size: 20,
    total_items: 1,
    total_pages: 1,
    has_next: false,
    has_previous: false,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B06 course management UI', () => {
  it('loads the teacher course list from the server API', async () => {
    const listSpy = vi.spyOn(coursesService, 'list').mockResolvedValue(paginatedCourses);

    render(
      <MemoryRouter>
        <TeacherCoursesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Lập trình Web')).toBeInTheDocument();
    expect(screen.getByText('5 sinh viên')).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalledWith({ role: 'teacher', status: 'open', page: 1, page_size: 20 });
  });

  it('creates courses through the API and navigates to the returned course id', async () => {
    const createSpy = vi.spyOn(coursesService, 'create').mockResolvedValue(sampleCourse);

    render(
      <MemoryRouter initialEntries={['/gv/mon-hoc/tao']}>
        <NotificationProvider>
          <Routes>
            <Route path="/gv/mon-hoc/tao" element={<CreateCoursePage />} />
            <Route path="/gv/mon-hoc/:monId" element={<div>Đã mở môn học</div>} />
          </Routes>
        </NotificationProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: /Tên môn học/ }), {
      target: { value: 'Lập trình Web' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Mã môn học/ }), {
      target: { value: 'WEB202' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Học kỳ' }), {
      target: { value: 'HK1-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo môn học' }));

    expect(await screen.findByText('Đã mở môn học')).toBeInTheDocument();
    expect(createSpy).toHaveBeenCalledWith({
      code: 'WEB202',
      name: 'Lập trình Web',
      term: 'HK1-2026',
      description: '',
    });
  });

  it('manages chapter structure through persistent API mutations', async () => {
    let chapters: Chapter[] = [];
    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
    vi.spyOn(coursesService, 'listChapters').mockImplementation(async () => chapters);
    vi.spyOn(coursesService, 'listLessons').mockResolvedValue([]);
    const createChapterSpy = vi
      .spyOn(coursesService, 'createChapter')
      .mockImplementation(async (_courseId, body) => {
        const created = { ...sampleChapter, title: body.title };
        chapters = [...chapters, created];
        return created;
      });

    render(
      <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/cau-truc`]}>
        <NotificationProvider>
          <Routes>
            <Route
              path="/gv/mon-hoc/:monId/cau-truc"
              element={<CourseStructurePage />}
            />
          </Routes>
        </NotificationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Thêm chương mới' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Tiêu đề chương/ }), {
      target: { value: 'Chương 1: API' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm chương' }));

    expect(await screen.findByText('Chương 1: API')).toBeInTheDocument();
    await waitFor(() =>
      expect(createChapterSpy).toHaveBeenCalledWith(sampleCourse.id, { title: 'Chương 1: API' }),
    );
  });

  it('uses server-side filtering and pagination for the admin course directory', async () => {
    const listSpy = vi.spyOn(coursesService, 'list').mockResolvedValue(paginatedCourses);
    render(
      <MemoryRouter>
        <AdminCoursesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Giảng viên Một')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Học kỳ' }), {
      target: { value: 'HK1-2026' },
    });
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ term: 'HK1-2026', page: 1, page_size: 20 }),
      ),
    );
  });
});


describe('B06 acceptance regressions', () => {
  it('keeps the latest admin filter results when an older request finishes later', async () => {
    let resolveOld!: (value: typeof paginatedCourses) => void;
    const oldResult = new Promise<typeof paginatedCourses>((resolve) => { resolveOld = resolve; });
    vi.spyOn(coursesService, 'list').mockImplementation((params) =>
      params?.search === 'new' ? Promise.resolve({ ...paginatedCourses, items: [{ ...sampleCourse, name: 'Newest result' }] }) : oldResult,
    );
    render(<MemoryRouter><AdminCoursesPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'new' } });
    expect(await screen.findByText('Newest result')).toBeInTheDocument();
    await act(async () => { resolveOld(paginatedCourses); });
    expect(screen.getByText('Newest result')).toBeInTheDocument();
    expect(screen.queryByText(sampleCourse.name)).not.toBeInTheDocument();
  });

  it('does not present failed teacher fetches as an empty successful list', async () => {
    vi.spyOn(coursesService, 'list').mockRejectedValue(new Error('Network unavailable'));
    render(<MemoryRouter><TeacherCoursesPage /></MemoryRouter>);
    expect(await screen.findByText('Network unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có môn học nào đang mở')).not.toBeInTheDocument();
  });

  it('refreshes the nested structure after archiving from the course header', async () => {
    let current = sampleCourse;
    vi.spyOn(coursesService, 'get').mockImplementation(async () => current);
    vi.spyOn(coursesService, 'listChapters').mockResolvedValue([]);
    vi.spyOn(coursesService, 'archive').mockImplementation(async () => {
      current = { ...sampleCourse, status: 'archived', archived_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z' };
      return current;
    });
    render(
      <MemoryRouter initialEntries={[`/gv/mon-hoc/${sampleCourse.id}/cau-truc`]}>
        <NotificationProvider><Routes>
          <Route path="/gv/mon-hoc/:monId" element={<CourseTeacherLayout />}>
            <Route path="cau-truc" element={<CourseStructurePage />} />
          </Route>
        </Routes></NotificationProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Thêm chương mới' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu trữ môn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận Lưu trữ' }));
    expect(await screen.findByText('Môn học đã lưu trữ: chế độ chỉ đọc, không thể thay đổi cấu trúc.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm chương mới' })).not.toBeInTheDocument();
  });
});
