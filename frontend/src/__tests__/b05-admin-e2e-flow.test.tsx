import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RegisterPage } from '../blueprints/identity/pages/RegisterPage';
import { VerifyEmailPage } from '../blueprints/identity/pages/VerifyEmailPage';
import { AdminTeacherApprovalPage } from '../blueprints/administration/pages/AdminTeacherApprovalPage';
import { AdminAccountDetailPage } from '../blueprints/administration/pages/AdminAccountDetailPage';
import { SessionProvider, useSession } from '../app/providers/SessionContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { authService, type SessionInfo } from '../api/authService';
import { AdminService, type AdminAccountDetail, type PaginatedAdminTeacherRequestItemList } from '../api/adminService';
import { ApiError } from '../api/client';

describe('T09 / B05 — Full Integration Lifecycle: Teacher Registration → Email Verification → Admin Approval → Active Grant → Lock/Revoke Invalidation', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    if (typeof document !== 'undefined') {
      document.cookie = 'csrftoken=test-csrf-token; path=/;';
    }
    vi.restoreAllMocks();
    vi.spyOn(authService, 'getCsrf').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('executes complete end-to-end flow from teacher registration to admin approval and session invalidation on lock', async () => {
    // -----------------------------------------------------------------------
    // STEP 1: Teacher Registration via RegisterPage
    // -----------------------------------------------------------------------
    const registerSpy = vi.spyOn(authService, 'register').mockResolvedValue({
      id: 'acc-teacher-e2e',
      email: 'giangvien.e2e@neu.edu.vn',
      display_name: 'TS. Nguyễn Văn Giáo Viên',
      requested_role: 'teacher',
      email_verified: false,
    });

    const { unmount: unmountRegister } = render(
      <MemoryRouter initialEntries={['/dang-ky']}>
        <NotificationProvider>
          <SessionProvider>
            <RegisterPage />
          </SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );

    // Switch role to Teacher
    const teacherRadio = screen.getByLabelText(/giảng viên/i);
    fireEvent.click(teacherRadio);

    // Fill form
    fireEvent.change(screen.getByLabelText(/họ và tên/i), {
      target: { value: 'TS. Nguyễn Văn Giáo Viên' },
    });
    fireEvent.change(screen.getByLabelText(/địa chỉ email/i), {
      target: { value: 'giangvien.e2e@neu.edu.vn' },
    });
    fireEvent.change(screen.getByLabelText(/^mật khẩu/i), {
      target: { value: 'SecurePass123!' },
    });
    fireEvent.change(screen.getByLabelText(/xác nhận mật khẩu/i), {
      target: { value: 'SecurePass123!' },
    });

    // Submit registration
    const submitRegisterBtn = screen.getByRole('button', { name: /tạo tài khoản/i });
    fireEvent.click(submitRegisterBtn);

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'giangvien.e2e@neu.edu.vn',
          display_name: 'TS. Nguyễn Văn Giáo Viên',
          requested_role: 'teacher',
        })
      );
    });

    unmountRegister();

    // -----------------------------------------------------------------------
    // STEP 2: Email Verification via VerifyEmailPage
    // -----------------------------------------------------------------------
    const verifySpy = vi.spyOn(authService, 'verifyEmail').mockResolvedValue({
      email: 'giangvien.e2e@neu.edu.vn',
      verified: true,
      granted_roles: [], // Teacher role is NOT automatically granted upon email verification
    });

    const { unmount: unmountVerify } = render(
      <MemoryRouter initialEntries={['/xac-minh-email?token=valid-token-1234567890abcdef']}>
        <NotificationProvider>
          <SessionProvider>
            <VerifyEmailPage />
          </SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );

    // Verify token was processed
    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledWith({
        token: 'valid-token-1234567890abcdef',
      });
    });

    // Check verification success notification and pending notice
    await waitFor(() => {
      expect(screen.getByText(/Xác minh email thành công/i)).toBeInTheDocument();
      expect(
        screen.getByText(/cần chờ Quản trị viên phê duyệt trước khi truy cập không gian Giảng dạy/i)
      ).toBeInTheDocument();
    });

    unmountVerify();

    // -----------------------------------------------------------------------
    // STEP 3: Admin Review & Approval in Teacher Approval Queue
    // -----------------------------------------------------------------------
    const adminSession: SessionInfo = {
      id: 'acc-admin-boss',
      email: 'admin.boss@neu.edu.vn',
      display_name: 'Quản trị viên Trưởng',
      email_verified: true,
      roles: ['admin'],
      pending_roles: [],
      idle_expires_at: '2026-10-26T00:00:00Z',
      absolute_expires_at: '2026-10-27T00:00:00Z',
    };
    vi.spyOn(authService, 'getMe').mockResolvedValue(adminSession);

    const pendingRequestsResponse: PaginatedAdminTeacherRequestItemList = {
      items: [
        {
          id: 'req-teacher-e2e-id',
          user_id: 'acc-teacher-e2e',
          user_email: 'giangvien.e2e@neu.edu.vn',
          user_display_name: 'TS. Nguyễn Văn Giáo Viên',
          role: 'teacher',
          status: 'pending',
          requested_at: '2026-10-25T10:00:00Z',
          reviewed_at: null,
          reviewed_by: null,
          review_reason: '',
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

    const mockAdminService = new AdminService();
    vi.spyOn(mockAdminService, 'listTeacherRequests').mockResolvedValue(pendingRequestsResponse);

    const approveSpy = vi.spyOn(mockAdminService, 'approveTeacherRequest').mockResolvedValue({
      id: 'req-teacher-e2e-id',
      user_id: 'acc-teacher-e2e',
      role: 'teacher',
      status: 'approved',
      granted_at: '2026-10-25T10:15:00Z',
    });

    const { unmount: unmountAdminApproval } = render(
      <MemoryRouter initialEntries={['/ad/duyet-giang-vien']}>
        <NotificationProvider>
          <SessionProvider>
            <AdminTeacherApprovalPage service={mockAdminService} />
          </SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );

    // Request is in list
    await waitFor(() => {
      expect(screen.getByText('giangvien.e2e@neu.edu.vn')).toBeInTheDocument();
      expect(screen.getByText('TS. Nguyễn Văn Giáo Viên')).toBeInTheDocument();
    });

    // Admin clicks "Duyệt"
    const approveBtn = screen.getByRole('button', { name: /duyệt yêu cầu của/i });
    fireEvent.click(approveBtn);

    // Confirm in modal
    expect(screen.getByText(/Xác nhận phê duyệt Giảng viên/i)).toBeInTheDocument();
    const confirmApproveBtn = screen.getByRole('button', { name: /xác nhận phê duyệt/i });
    fireEvent.click(confirmApproveBtn);

    await waitFor(() => {
      expect(approveSpy).toHaveBeenCalledWith('req-teacher-e2e-id');
    });

    unmountAdminApproval();

    // -----------------------------------------------------------------------
    // STEP 4: Teacher Login / Refresh Session receives Active Teacher Grant
    // -----------------------------------------------------------------------
    const approvedTeacherSession: SessionInfo = {
      id: 'acc-teacher-e2e',
      email: 'giangvien.e2e@neu.edu.vn',
      display_name: 'TS. Nguyễn Văn Giáo Viên',
      email_verified: true,
      roles: ['teacher'], // Now has active teacher grant from server
      pending_roles: [],
      idle_expires_at: '2026-10-26T00:00:00Z',
      absolute_expires_at: '2026-10-27T00:00:00Z',
    };

    // Component observing session state
    const SessionObserver = () => {
      const { currentUser, role, roles, refreshSession } = useSession();
      return (
        <div>
          <span data-testid="user-email">{currentUser?.emailNormalized}</span>
          <span data-testid="user-role">{role}</span>
          <span data-testid="user-roles">{roles.join(',')}</span>
          <button onClick={() => refreshSession()}>Làm mới phiên</button>
        </div>
      );
    };

    vi.spyOn(authService, 'getMe').mockResolvedValue(approvedTeacherSession);

    const { unmount: unmountTeacherSession } = render(
      <MemoryRouter>
        <NotificationProvider>
          <SessionProvider>
            <SessionObserver />
          </SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('giangvien.e2e@neu.edu.vn');
      expect(screen.getByTestId('user-role')).toHaveTextContent('teacher');
      expect(screen.getByTestId('user-roles')).toHaveTextContent('teacher');
    });

    unmountTeacherSession();

    // -----------------------------------------------------------------------
    // STEP 5: Admin Locks Account & Invalidation of Sessions
    // -----------------------------------------------------------------------
    const teacherAccountDetail: AdminAccountDetail = {
      id: 'acc-teacher-e2e',
      email: 'giangvien.e2e@neu.edu.vn',
      display_name: 'TS. Nguyễn Văn Giáo Viên',
      is_active: true,
      email_verified: true,
      verified_at: '2026-10-25T10:05:00Z',
      created_at: '2026-10-25T10:00:00Z',
      updated_at: '2026-10-25T10:15:00Z',
      roles: [
        {
          id: 'grant-teacher-id',
          role: 'teacher',
          granted_by: 'acc-admin-boss',
          granted_at: '2026-10-25T10:15:00Z',
          grant_source: 'admin_approved',
          revoked_at: null,
          revoke_reason: '',
        },
      ],
      role_requests: [
        {
          id: 'req-teacher-e2e-id',
          role: 'teacher',
          status: 'approved',
          requested_at: '2026-10-25T10:00:00Z',
          reviewed_at: '2026-10-25T10:15:00Z',
          reviewed_by: 'acc-admin-boss',
          review_reason: '',
        },
      ],
    };

    // Admin views account detail
    vi.spyOn(authService, 'getMe').mockResolvedValue(adminSession);
    vi.spyOn(mockAdminService, 'getAccount').mockResolvedValue(teacherAccountDetail);
    const lockSpy = vi.spyOn(mockAdminService, 'setAccountState').mockResolvedValue({
      id: 'acc-teacher-e2e',
      is_active: false,
    });

    const { unmount: unmountAdminLock } = render(
      <MemoryRouter initialEntries={['/ad/tai-khoan/acc-teacher-e2e']}>
        <NotificationProvider>
          <SessionProvider>
            <Routes>
              <Route
                path="/ad/tai-khoan/:taiKhoanId"
                element={<AdminAccountDetailPage service={mockAdminService} />}
              />
            </Routes>
          </SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('giangvien.e2e@neu.edu.vn')).toBeInTheDocument();
    });

    // Click "Khóa tài khoản"
    const lockBtn = screen.getByRole('button', { name: /khóa tài khoản/i });
    fireEvent.click(lockBtn);

    // Modal appears warning that active sessions will be invalidated
    expect(
      screen.getByText(/tất cả các phiên đăng nhập đang hoạt động của người dùng sẽ lập tức bị thu hồi/i)
    ).toBeInTheDocument();

    const confirmLockBtn = screen.getByRole('button', { name: /xác nhận khóa tài khoản/i });
    fireEvent.click(confirmLockBtn);

    await waitFor(() => {
      expect(lockSpy).toHaveBeenCalledWith('acc-teacher-e2e', false, undefined);
    });

    unmountAdminLock();

    // -----------------------------------------------------------------------
    // STEP 6: Target User Session is Rejected by Server (401 account_inactive)
    // -----------------------------------------------------------------------
    // When target user makes any request with invalidated session:
    const sessionRevokedError = new ApiError(401, {
      code: 'account_inactive',
      message: 'Tài khoản đã bị vô hiệu hóa hoặc khóa.',
    });
    vi.spyOn(authService, 'getMe').mockRejectedValue(sessionRevokedError);

    const TargetUserSessionTester = () => {
      const { status, currentUser } = useSession();
      return (
        <div>
          <span data-testid="session-status">{status}</span>
          <span data-testid="session-user">{currentUser ? currentUser.emailNormalized : 'none'}</span>
        </div>
      );
    };

    render(
      <MemoryRouter>
        <NotificationProvider>
          <SessionProvider>
            <TargetUserSessionTester />
          </SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );

    // User session state drops to anonymous immediately
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('anonymous');
      expect(screen.getByTestId('session-user')).toHaveTextContent('none');
    });
  });
});
