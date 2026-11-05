import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminAccountsPage } from '../blueprints/administration/pages/AdminAccountsPage';
import { AdminAccountDetailPage } from '../blueprints/administration/pages/AdminAccountDetailPage';
import { AdminTeacherApprovalPage } from '../blueprints/administration/pages/AdminTeacherApprovalPage';
import { SessionProvider } from '../app/providers/SessionContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import {
  AdminService,
  type AdminAccountDetail,
  type PaginatedAdminAccountListItemList,
  type PaginatedAdminTeacherRequestItemList,
} from '../api/adminService';
import { authService, type SessionInfo } from '../api/authService';
import { ApiError } from '../api/client';

describe('T09 / B05 — Admin UI: Accounts, Detail, Teacher Approvals & Policy Enforcement', () => {
  const originalFetch = globalThis.fetch;

  const mockAdminSession: SessionInfo = {
    id: 'acc-admin-1',
    email: 'admin.active@neu.edu.vn',
    display_name: 'Quản trị viên Tổng',
    email_verified: true,
    roles: ['admin'],
    pending_roles: [],
    idle_expires_at: '2026-10-26T00:00:00Z',
    absolute_expires_at: '2026-10-27T00:00:00Z',
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    if (typeof document !== 'undefined') {
      document.cookie = 'csrftoken=test-csrf-token; path=/;';
    }
    vi.restoreAllMocks();
    vi.spyOn(authService, 'getCsrf').mockResolvedValue(undefined);
    vi.spyOn(authService, 'getMe').mockResolvedValue(mockAdminSession);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const renderWithProviders = (ui: React.ReactElement, initialPath = '/ad') => {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <NotificationProvider>
          <SessionProvider>{ui}</SessionProvider>
        </NotificationProvider>
      </MemoryRouter>
    );
  };

  // =========================================================================
  // 1. AdminAccountsPage
  // =========================================================================
  describe('AdminAccountsPage Component', () => {
    it('fetches accounts with pagination/filters and renders table accurately', async () => {
      const mockAccountsResponse: PaginatedAdminAccountListItemList = {
        items: [
          {
            id: 'acc-1',
            email: 'student1@st.neu.edu.vn',
            display_name: 'Sinh viên Một',
            is_active: true,
            email_verified: true,
            roles: ['student'],
            created_at: '2026-10-20T08:00:00Z',
            updated_at: '2026-10-20T08:00:00Z',
          },
          {
            id: 'acc-2',
            email: 'teacher1@neu.edu.vn',
            display_name: 'Giảng viên Một',
            is_active: false,
            email_verified: true,
            roles: ['teacher'],
            created_at: '2026-10-21T09:00:00Z',
            updated_at: '2026-10-22T10:00:00Z',
          },
        ],
        pagination: {
          page: 1,
          page_size: 20,
          total_items: 2,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        },
      };

      const mockService = new AdminService();
      const listSpy = vi.spyOn(mockService, 'listAccounts').mockResolvedValue(mockAccountsResponse);

      renderWithProviders(<AdminAccountsPage service={mockService} />, '/ad/tai-khoan');

      // Table rows should appear
      await waitFor(() => {
        expect(screen.getByText('student1@st.neu.edu.vn')).toBeInTheDocument();
        expect(screen.getByText('teacher1@neu.edu.vn')).toBeInTheDocument();
      });

      expect(screen.getByText('Sinh viên Một')).toBeInTheDocument();
      expect(screen.getByText('Giảng viên Một')).toBeInTheDocument();

      // Check status badges
      expect(screen.getByText('Hoạt động')).toBeInTheDocument();
      expect(screen.getByText('Đã khóa')).toBeInTheDocument();

      // Verify listAccounts was called with default params
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          page_size: 10,
        })
      );
    });

    it('displays error banner with retry button on network failure', async () => {
      const mockService = new AdminService();
      const listSpy = vi
        .spyOn(mockService, 'listAccounts')
        .mockRejectedValueOnce(new Error('Mạng bị gián đoạn, không thể tải dữ liệu.'))
        .mockResolvedValueOnce({
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

      renderWithProviders(<AdminAccountsPage service={mockService} />, '/ad/tai-khoan');

      await waitFor(() => {
        expect(screen.getByText(/Mạng bị gián đoạn, không thể tải dữ liệu/i)).toBeInTheDocument();
      });

      const retryBtn = screen.getByRole('button', { name: /thử lại/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(listSpy).toHaveBeenCalledTimes(2);
      });
    });

    it('renders empty state when server returns zero accounts', async () => {
      const mockService = new AdminService();
      vi.spyOn(mockService, 'listAccounts').mockResolvedValue({
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

      renderWithProviders(<AdminAccountsPage service={mockService} />, '/ad/tai-khoan');

      await waitFor(() => {
        expect(screen.getByText(/Không tìm thấy tài khoản/i)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 2. AdminAccountDetailPage
  // =========================================================================
  describe('AdminAccountDetailPage Component', () => {
    const mockTargetAccount: AdminAccountDetail = {
      id: 'acc-target-2',
      email: 'teacher.target@neu.edu.vn',
      display_name: 'Nguyễn Văn Giảng Viên',
      is_active: true,
      email_verified: true,
      verified_at: '2026-10-20T10:00:00Z',
      created_at: '2026-10-20T10:00:00Z',
      updated_at: '2026-10-20T10:00:00Z',
      roles: [
        {
          id: 'grant-1',
          role: 'teacher',
          granted_by: 'acc-admin-1',
          granted_at: '2026-10-21T08:00:00Z',
          grant_source: 'admin_approved',
          revoked_at: null,
          revoke_reason: '',
        },
      ],
      role_requests: [
        {
          id: 'req-1',
          role: 'teacher',
          status: 'pending',
          requested_at: '2026-10-21T07:00:00Z',
          reviewed_at: null,
          reviewed_by: null,
          review_reason: '',
        },
      ],
    };

    it('renders account detail, active grants, and role requests correctly', async () => {
      const mockService = new AdminService();
      vi.spyOn(mockService, 'getAccount').mockResolvedValue(mockTargetAccount);

      render(
        <MemoryRouter initialEntries={['/ad/tai-khoan/acc-target-2']}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/ad/tai-khoan/:taiKhoanId" element={<AdminAccountDetailPage service={mockService} />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('teacher.target@neu.edu.vn')).toBeInTheDocument();
        expect(screen.getAllByText('Nguyễn Văn Giảng Viên').length).toBeGreaterThan(0);
      });

      // Role badge and requests
      expect(screen.getAllByText('Giảng viên').length).toBeGreaterThan(0);
      expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    });

    it('requires D02 password re-authentication when granting admin role', async () => {
      const mockService = new AdminService();
      vi.spyOn(mockService, 'getAccount').mockResolvedValue(mockTargetAccount);
      const grantAdminSpy = vi.spyOn(mockService, 'grantAdminRole').mockResolvedValue({
        id: 'grant-admin-new',
        user_id: 'acc-target-2',
        role: 'admin',
        granted_at: '2026-10-25T10:00:00Z',
      });

      render(
        <MemoryRouter initialEntries={['/ad/tai-khoan/acc-target-2']}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/ad/tai-khoan/:taiKhoanId" element={<AdminAccountDetailPage service={mockService} />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('teacher.target@neu.edu.vn')).toBeInTheDocument();
      });

      // Click "Cấp quyền Quản trị viên"
      const grantAdminBtn = screen.getByRole('button', { name: /cấp quyền quản trị viên/i });
      fireEvent.click(grantAdminBtn);

      // Modal should appear requiring password
      expect(screen.getByText(/Cấp vai trò Quản trị viên/i)).toBeInTheDocument();
      const pwdInput = screen.getByLabelText(/mật khẩu của bạn để xác thực/i);
      expect(pwdInput).toBeInTheDocument();

      // Enter password and submit
      fireEvent.change(pwdInput, { target: { value: 'AdminPass123!' } });
      const confirmBtn = screen.getByRole('button', { name: /xác nhận cấp quyền quản trị viên/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(grantAdminSpy).toHaveBeenCalledWith('acc-target-2', 'AdminPass123!');
      });
    });

    it('handles last_active_admin rejection with clear Vietnamese advisory message', async () => {
      const mockAdminAccount: AdminAccountDetail = {
        id: 'acc-admin-sole',
        email: 'sole.admin@neu.edu.vn',
        display_name: 'Quản trị viên Độc nhất',
        is_active: true,
        email_verified: true,
        verified_at: '2026-10-20T10:00:00Z',
        created_at: '2026-10-20T10:00:00Z',
        updated_at: '2026-10-20T10:00:00Z',
        roles: [
          {
            id: 'grant-admin-sole',
            role: 'admin',
            granted_by: null,
            granted_at: '2026-10-20T10:00:00Z',
            grant_source: 'system',
            revoked_at: null,
            revoke_reason: '',
          },
        ],
        role_requests: [],
      };

      const mockService = new AdminService();
      vi.spyOn(mockService, 'getAccount').mockResolvedValue(mockAdminAccount);

      // Simulate 400 rejection with code "last_active_admin"
      const lastAdminError = new ApiError(400, {
        code: 'last_active_admin',
        message: 'Không thể khóa hoặc thu hồi quyền quản trị viên đang hoạt động duy nhất của hệ thống.',
      });
      vi.spyOn(mockService, 'setAccountState').mockRejectedValue(lastAdminError);

      render(
        <MemoryRouter initialEntries={['/ad/tai-khoan/acc-admin-sole']}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/ad/tai-khoan/:taiKhoanId" element={<AdminAccountDetailPage service={mockService} />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('sole.admin@neu.edu.vn')).toBeInTheDocument();
      });

      // Open lock modal
      const lockBtn = screen.getByRole('button', { name: /khóa tài khoản/i });
      fireEvent.click(lockBtn);

      // Admin lock requires password
      const pwdInput = screen.getByLabelText(/mật khẩu của bạn/i);
      fireEvent.change(pwdInput, { target: { value: 'AdminPass123!' } });

      const confirmLockBtn = screen.getByRole('button', { name: /xác nhận khóa tài khoản/i });
      fireEvent.click(confirmLockBtn);

      // Check last-active-admin advisory message in toast
      await waitFor(() => {
        expect(
          screen.getByText(/Thao tác bị từ chối: Đây là Quản trị viên hoạt động duy nhất còn lại của hệ thống/i)
        ).toBeInTheDocument();
      });
    });

    it('dispatches password reset via server email without exposing secrets', async () => {
      const mockService = new AdminService();
      vi.spyOn(mockService, 'getAccount').mockResolvedValue(mockTargetAccount);
      const resetSpy = vi.spyOn(mockService, 'requestPasswordReset').mockResolvedValue({
        message: 'Yêu cầu đặt lại mật khẩu đã được tiếp nhận và xử lý gửi qua email.',
      });

      render(
        <MemoryRouter initialEntries={['/ad/tai-khoan/acc-target-2']}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/ad/tai-khoan/:taiKhoanId" element={<AdminAccountDetailPage service={mockService} />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('teacher.target@neu.edu.vn')).toBeInTheDocument();
      });

      // Click "Gửi liên kết đặt lại mật khẩu"
      const resetBtn = screen.getByRole('button', { name: /gửi liên kết đặt lại mật khẩu/i });
      fireEvent.click(resetBtn);

      // Modal prompt
      expect(screen.getByText(/Khởi tạo đặt lại mật khẩu người dùng/i)).toBeInTheDocument();
      const confirmResetBtn = screen.getByRole('button', { name: /gửi liên kết qua email/i });
      fireEvent.click(confirmResetBtn);

      await waitFor(() => {
        expect(resetSpy).toHaveBeenCalledWith('acc-target-2');
      });

      // Ensure no raw token or password is shown in document
      expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
    });

    it('disables lock and revoke actions when viewing own account (self-guard)', async () => {
      const mockSelfAccount: AdminAccountDetail = {
        id: 'acc-admin-1', // Matches logged in mockAdminSession
        email: 'admin.active@neu.edu.vn',
        display_name: 'Quản trị viên Tổng',
        is_active: true,
        email_verified: true,
        verified_at: '2026-10-20T10:00:00Z',
        created_at: '2026-10-20T10:00:00Z',
        updated_at: '2026-10-20T10:00:00Z',
        roles: [
          {
            id: 'grant-self-admin',
            role: 'admin',
            granted_by: null,
            granted_at: '2026-10-20T10:00:00Z',
            grant_source: 'system',
            revoked_at: null,
            revoke_reason: '',
          },
        ],
        role_requests: [],
      };

      const mockService = new AdminService();
      vi.spyOn(mockService, 'getAccount').mockResolvedValue(mockSelfAccount);

      render(
        <MemoryRouter initialEntries={['/ad/tai-khoan/acc-admin-1']}>
          <NotificationProvider>
            <SessionProvider>
              <Routes>
                <Route path="/ad/tai-khoan/:taiKhoanId" element={<AdminAccountDetailPage service={mockService} />} />
              </Routes>
            </SessionProvider>
          </NotificationProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('admin.active@neu.edu.vn')).toBeInTheDocument();
      });

      // Lock button must not be rendered
      expect(screen.queryByRole('button', { name: /khóa tài khoản/i })).not.toBeInTheDocument();

      // Revoke button must not be rendered on active grant
      expect(screen.queryByRole('button', { name: /thu hồi/i })).not.toBeInTheDocument();

      // Self-protection notice should be visible
      expect(screen.getByText(/Tài khoản cá nhân/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 3. AdminTeacherApprovalPage
  // =========================================================================
  describe('AdminTeacherApprovalPage Component', () => {
    const mockTeacherRequestsResponse: PaginatedAdminTeacherRequestItemList = {
      items: [
        {
          id: 'req-teacher-1',
          user_id: 'acc-user-1',
          user_email: 'instructor@neu.edu.vn',
          user_display_name: 'ThS. Trần Thị Giảng Viên',
          role: 'teacher',
          status: 'pending',
          requested_at: '2026-10-22T08:00:00Z',
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

    it('lists teacher approval requests with status filter tabs and triggers approval modal', async () => {
      const mockService = new AdminService();
      const listSpy = vi
        .spyOn(mockService, 'listTeacherRequests')
        .mockResolvedValue(mockTeacherRequestsResponse);

      const approveSpy = vi.spyOn(mockService, 'approveTeacherRequest').mockResolvedValue({
        id: 'req-teacher-1',
        user_id: 'acc-user-1',
        role: 'teacher',
        status: 'approved',
        granted_at: '2026-10-25T10:00:00Z',
      });

      renderWithProviders(<AdminTeacherApprovalPage service={mockService} />, '/ad/duyet-giang-vien');

      await waitFor(() => {
        expect(screen.getByText('instructor@neu.edu.vn')).toBeInTheDocument();
        expect(screen.getByText('ThS. Trần Thị Giảng Viên')).toBeInTheDocument();
      });

      // Click "Duyệt" button
      const approveBtn = screen.getByRole('button', { name: /duyệt yêu cầu của/i });
      fireEvent.click(approveBtn);

      // Approval Modal appears
      expect(screen.getByText(/Xác nhận phê duyệt Giảng viên/i)).toBeInTheDocument();
      const confirmApproveBtn = screen.getByRole('button', { name: /xác nhận phê duyệt/i });
      fireEvent.click(confirmApproveBtn);

      await waitFor(() => {
        expect(approveSpy).toHaveBeenCalledWith('req-teacher-1');
      });

      // Page reloads requests after successful approval
      await waitFor(() => {
        expect(listSpy).toHaveBeenCalledTimes(2);
      });
    });


    it('sends all explicitly and ignores a stale pending response', async () => {
      const service = new AdminService();
      let finishOld!: (value: PaginatedAdminTeacherRequestItemList) => void;
      const closed = {
        ...mockTeacherRequestsResponse,
        items: [{ ...mockTeacherRequestsResponse.items[0], user_email: 'closed@example.org', status: 'rejected' }],
      };
      const list = vi.spyOn(service, 'listTeacherRequests')
        .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
        .mockResolvedValue(closed);
      renderWithProviders(<AdminTeacherApprovalPage service={service} />, '/ad/duyet-giang-vien');
      await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('tab', { name: /Tất cả yêu cầu/i }));
      await screen.findByText('closed@example.org');
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all' }));
      await act(async () => finishOld(mockTeacherRequestsResponse));
      expect(screen.queryByText('instructor@neu.edu.vn')).not.toBeInTheDocument();
      expect(screen.getByText('closed@example.org')).toBeInTheDocument();
    });

    it('shows a fetch error without a contradictory empty-state claim', async () => {
      const service = new AdminService();
      vi.spyOn(service, 'listTeacherRequests').mockRejectedValue(new TypeError('Network failed'));
      renderWithProviders(<AdminTeacherApprovalPage service={service} />, '/ad/duyet-giang-vien');
      await screen.findByText('Network failed');
      expect(screen.queryByText('Không có yêu cầu giảng viên nào')).not.toBeInTheDocument();
    });

    it('rejects teacher request with the server-defined reason code', async () => {
      const mockService = new AdminService();
      vi.spyOn(mockService, 'listTeacherRequests').mockResolvedValue(mockTeacherRequestsResponse);
      const rejectSpy = vi.spyOn(mockService, 'rejectTeacherRequest').mockResolvedValue({
        id: 'req-teacher-1',
        status: 'rejected',
        reviewed_at: '2026-10-25T10:00:00Z',
      });

      renderWithProviders(<AdminTeacherApprovalPage service={mockService} />, '/ad/duyet-giang-vien');

      await waitFor(() => {
        expect(screen.getByText('instructor@neu.edu.vn')).toBeInTheDocument();
      });

      // Click "Từ chối" button
      const rejectBtn = screen.getByRole('button', { name: /từ chối yêu cầu của/i });
      fireEvent.click(rejectBtn);

      // Rejection modal appears
      expect(screen.getByText(/Từ chối yêu cầu vai trò Giảng viên/i)).toBeInTheDocument();

      // Submit rejection
      const confirmRejectBtn = screen.getByRole('button', { name: /xác nhận từ chối/i });
      fireEvent.click(confirmRejectBtn);

      await waitFor(() => {
        expect(rejectSpy).toHaveBeenCalledWith('req-teacher-1');
      });
    });
  });
});
