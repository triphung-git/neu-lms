import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CourseMembersPage } from '../blueprints/memberships/pages/CourseMembersPage';
import { NotificationProvider } from '../app/providers/NotificationContext';
import {
  coursesService,
  type Course,
  type CourseMember,
  type TeacherEnrollmentRequest,
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

const sampleMembers: CourseMember[] = [
  {
    id: '0b0b0b0b-1111-4111-8111-000000000001',
    course_id: sampleCourse.id,
    student_id: '0c0c0c0c-1111-4111-8111-000000000001',
    student_name: 'Trần Thị Mai',
    student_email: 'mai.tt@neu.edu.vn',
    status: 'active',
    added_at: '2026-10-21T08:00:00Z',
    updated_at: '2026-10-21T08:00:00Z',
  },
  {
    id: '0b0b0b0b-1111-4111-8111-000000000002',
    course_id: sampleCourse.id,
    student_id: '0c0c0c0c-1111-4111-8111-000000000002',
    student_name: 'Lê Hoàng Nam',
    student_email: 'nam.lh@neu.edu.vn',
    status: 'withdrawn',
    added_at: '2026-10-22T08:00:00Z',
    updated_at: '2026-10-23T08:00:00Z',
  },
];

const sampleRequests: TeacherEnrollmentRequest[] = [
  {
    id: '0d0d0d0d-1111-4111-8111-000000000001',
    course_id: sampleCourse.id,
    student_id: '0c0c0c0c-1111-4111-8111-000000000003',
    student_name: 'Phạm Đức Anh',
    student_email: 'anh.pd@neu.edu.vn',
    status: 'pending',
    requested_at: '2026-10-24T09:00:00Z',
    reviewed_at: null,
    reviewed_by_name: null,
    rejection_reason: '',
    created_at: '2026-10-24T09:00:00Z',
    updated_at: '2026-10-24T09:00:00Z',
  },
  {
    id: '0d0d0d0d-1111-4111-8111-000000000002',
    course_id: sampleCourse.id,
    student_id: '0c0c0c0c-1111-4111-8111-000000000004',
    student_name: 'Vũ Minh Tuấn',
    student_email: 'tuan.vm@neu.edu.vn',
    status: 'rejected',
    requested_at: '2026-10-23T10:00:00Z',
    reviewed_at: '2026-10-24T11:00:00Z',
    reviewed_by_name: 'TS. Nguyễn Văn A',
    rejection_reason: 'Chưa đủ điều kiện tiên quyết',
    created_at: '2026-10-23T10:00:00Z',
    updated_at: '2026-10-24T11:00:00Z',
  },
];

function renderPage(courseId = sampleCourse.id) {
  return render(
    <MemoryRouter initialEntries={[`/gv/mon-hoc/${courseId}/thanh-vien`]}>
      <NotificationProvider>
        <Routes>
          <Route path="/gv/mon-hoc/:monId/thanh-vien" element={<CourseMembersPage />} />
          <Route path="/gv/mon-hoc" element={<div>Danh sách môn học GV</div>} />
          <Route path="/gv" element={<div>Bàn làm việc GV</div>} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

describe('B07-06 Teacher Course Members & Enrollment Requests UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleCourse);
    vi.spyOn(coursesService, 'getCourseMembers').mockResolvedValue({
      items: [...sampleMembers],
      pagination: {
        page: 1,
        page_size: 20,
        total_items: sampleMembers.length,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    });
    vi.spyOn(coursesService, 'getCourseEnrollmentRequests').mockResolvedValue({
      items: [...sampleRequests],
      pagination: {
        page: 1,
        page_size: 20,
        total_items: sampleRequests.length,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Render thông tin môn học, toggle nhận ghi danh và danh sách thành viên ban đầu', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Quản lý thành viên & Ghi danh')).toBeInTheDocument();
    });

    // Check admission toggle card
    expect(screen.getByText('Đang mở nhận ghi danh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Đóng nhận ghi danh/i })).toBeInTheDocument();

    // Check members table
    await waitFor(() => {
      expect(screen.getByText('Trần Thị Mai')).toBeInTheDocument();
      expect(screen.getByText('mai.tt@neu.edu.vn')).toBeInTheDocument();
      expect(screen.getByText('Lê Hoàng Nam')).toBeInTheDocument();
      expect(screen.getByText('nam.lh@neu.edu.vn')).toBeInTheDocument();
    });
  });

  it('2. Bật/tắt nhận ghi danh gọi coursesService.update', async () => {
    const updateSpy = vi.spyOn(coursesService, 'update').mockResolvedValue({
      ...sampleCourse,
      enrollment_open: false,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Đóng nhận ghi danh/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Đóng nhận ghi danh/i }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(sampleCourse.id, { enrollment_open: false });
      expect(screen.getByText('Đang đóng')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Mở nhận ghi danh/i })).toBeInTheDocument();
    });
  });

  it('3. Thêm sinh viên thành công gọi coursesService.addCourseMember và refresh', async () => {
    const newMember: CourseMember = {
      id: '0b0b0b0b-1111-4111-8111-000000000099',
      course_id: sampleCourse.id,
      student_id: '0c0c0c0c-1111-4111-8111-000000000099',
      student_name: 'Nguyễn Văn Mới',
      student_email: 'moi.nv@neu.edu.vn',
      status: 'active',
      added_at: '2026-10-27T08:00:00Z',
      updated_at: '2026-10-27T08:00:00Z',
    };

    const addSpy = vi.spyOn(coursesService, 'addCourseMember').mockResolvedValue(newMember);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Thêm sinh viên/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Thêm sinh viên/i }));

    expect(screen.getByText('Thêm sinh viên vào lớp học phần')).toBeInTheDocument();
    const input = screen.getByLabelText(/Địa chỉ email sinh viên/i);
    fireEvent.change(input, { target: { value: 'moi.nv@neu.edu.vn' } });

    fireEvent.click(screen.getByRole('button', { name: /Ghi danh sinh viên/i }));

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith(sampleCourse.id, 'moi.nv@neu.edu.vn');
      expect(screen.queryByText('Thêm sinh viên vào lớp học phần')).not.toBeInTheDocument();
    });
  });

  it('4. Thêm sinh viên thất bại khi email không tồn tại hiển thị lỗi chính xác', async () => {
    vi.spyOn(coursesService, 'addCourseMember').mockRejectedValue({
      status: 400,
      data: { detail: 'Không tìm thấy tài khoản sinh viên với email này.' },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Thêm sinh viên/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Thêm sinh viên/i }));

    const input = screen.getByLabelText(/Địa chỉ email sinh viên/i);
    fireEvent.change(input, { target: { value: 'khongtontai@neu.edu.vn' } });

    fireEvent.click(screen.getByRole('button', { name: /Ghi danh sinh viên/i }));

    await waitFor(() => {
      expect(screen.getByText('Không tìm thấy tài khoản sinh viên với email này.')).toBeInTheDocument();
    });
  });

  it('5. Rút môn thành viên mở modal xác nhận và gọi coursesService.withdrawMember', async () => {
    const withdrawSpy = vi.spyOn(coursesService, 'withdrawMember').mockResolvedValue({
      ...sampleMembers[0],
      status: 'withdrawn',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Trần Thị Mai')).toBeInTheDocument();
    });

    const withdrawBtn = screen.getByRole('button', { name: /Rút sinh viên Trần Thị Mai/i });
    fireEvent.click(withdrawBtn);

    expect(screen.getByText('Xác nhận rút học phần')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Xác nhận rút/i }));

    await waitFor(() => {
      expect(withdrawSpy).toHaveBeenCalledWith(sampleCourse.id, sampleMembers[0].student_id);
      expect(screen.queryByText('Xác nhận rút học phần')).not.toBeInTheDocument();
    });
  });

  it('6. Khôi phục thành viên đã rút gọi coursesService.reEnrollMember', async () => {
    const restoreSpy = vi.spyOn(coursesService, 'reEnrollMember').mockResolvedValue({
      ...sampleMembers[1],
      status: 'active',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Lê Hoàng Nam')).toBeInTheDocument();
    });

    const restoreBtn = screen.getByRole('button', { name: /Khôi phục sinh viên Lê Hoàng Nam/i });
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(restoreSpy).toHaveBeenCalledWith(sampleCourse.id, sampleMembers[1].student_id);
    });
  });

  it('7. Chuyển tab Hàng đợi ghi danh và duyệt yêu cầu', async () => {
    const approveSpy = vi.spyOn(coursesService, 'approveEnrollmentRequest').mockResolvedValue({
      ...sampleRequests[0],
      status: 'approved',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Hàng đợi ghi danh/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Hàng đợi ghi danh/i }));

    await waitFor(() => {
      expect(screen.getByText('Phạm Đức Anh')).toBeInTheDocument();
      expect(screen.getByText('Chưa đủ điều kiện tiên quyết')).toBeInTheDocument();
    });

    const approveBtn = screen.getByRole('button', { name: /Duyệt yêu cầu Phạm Đức Anh/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(approveSpy).toHaveBeenCalledWith(sampleRequests[0].id);
    });
  });

  it('8. Từ chối yêu cầu mở modal nhập lý do và gọi coursesService.rejectEnrollmentRequest', async () => {
    const rejectSpy = vi.spyOn(coursesService, 'rejectEnrollmentRequest').mockResolvedValue({
      ...sampleRequests[0],
      status: 'rejected',
      rejection_reason: 'Lớp đã đủ sĩ số',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Hàng đợi ghi danh/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Hàng đợi ghi danh/i }));

    await waitFor(() => {
      expect(screen.getByText('Phạm Đức Anh')).toBeInTheDocument();
    });

    const rejectBtn = screen.getByRole('button', { name: /Từ chối yêu cầu Phạm Đức Anh/i });
    fireEvent.click(rejectBtn);

    expect(screen.getByText('Từ chối yêu cầu ghi danh')).toBeInTheDocument();
    const reasonInput = screen.getByLabelText(/Lý do từ chối/i);
    fireEvent.change(reasonInput, { target: { value: 'Lớp đã đủ sĩ số' } });

    fireEvent.click(screen.getByRole('button', { name: /Xác nhận từ chối/i }));

    await waitFor(() => {
      expect(rejectSpy).toHaveBeenCalledWith(sampleRequests[0].id, 'Lớp đã đủ sĩ số');
      expect(screen.queryByText('Từ chối yêu cầu ghi danh')).not.toBeInTheDocument();
    });
  });

  it('9. Môn học đã lưu trữ (archived) khóa mọi mutation UI', async () => {
    vi.spyOn(coursesService, 'get').mockResolvedValue(sampleArchivedCourse);

    renderPage(sampleArchivedCourse.id);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Môn học đã lưu trữ/i);
    });

    // Check admission toggle is disabled
    const toggleBtn = screen.getByRole('button', { name: /Mở nhận ghi danh/i });
    expect(toggleBtn).toBeDisabled();

    // Check add member button does not exist
    expect(screen.queryByRole('button', { name: /Thêm sinh viên/i })).not.toBeInTheDocument();

    // Check action buttons in table do not exist
    expect(screen.queryByRole('button', { name: /Rút sinh viên/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Khôi phục sinh viên/i })).not.toBeInTheDocument();
  });

  it('10. Foreign teacher bị chặn với 403 Forbidden', async () => {
    vi.spyOn(coursesService, 'get').mockRejectedValue({
      status: 403,
      message: 'Permission denied',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Không có quyền truy cập')).toBeInTheDocument();
      expect(
        screen.getByText(/Bạn không có quyền quản lý thành viên của môn học này/i),
      ).toBeInTheDocument();
    });
  });
  it('paginates members and searches across server results', async () => {
    const pagination = { page: 1, page_size: 20, total_items: 21, total_pages: 2, has_next: true, has_previous: false };
    const spy = vi.spyOn(coursesService, 'getCourseMembers').mockImplementation(async (_id, params) => ({
      items: params?.page === 2 ? [{ ...sampleMembers[0], student_name: 'Page two student' }] : sampleMembers,
      pagination: { ...pagination, page: params?.page || 1 },
    }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Trang sau' }));
    expect(await screen.findByText('Page two student')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm thành viên' }), { target: { value: 'target' } });
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(sampleCourse.id, expect.objectContaining({ page: 1, search: 'target' })));
  });

});
