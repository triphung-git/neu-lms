import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { RegisterPage } from '../blueprints/identity/pages/RegisterPage';
import { VerifyEmailPage } from '../blueprints/identity/pages/VerifyEmailPage';
import { ProfilePage } from '../blueprints/identity/pages/ProfilePage';
import { RouteGuard } from '../app/router/RouteGuard';
import { SessionProvider } from '../app/providers/SessionContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { authService, type RoleGrantItem, type RoleRequestItem, type SessionInfo } from '../api/authService';
import { ApiError } from '../api/client';
import { getRoleDashboardPath } from '../shared/lib/safeNavigation';

describe('T06 / B04 — Auth UI: Registration, Verification & Role State', () => {
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

  // =========================================================================
  // 1. RegisterPage
  // =========================================================================
  describe('RegisterPage Component', () => {
    it('validates student email format against NEU student regex pattern', async () => {
      render(
        <MemoryRouter initialEntries={['/dang-ky']}>
          <RegisterPage />
        </MemoryRouter>
      );

      // Student is selected by default
      const nameInput = screen.getByLabelText(/họ và tên/i);
      const emailInput = screen.getByLabelText(/địa chỉ email/i);
      const passwordInput = screen.getByLabelText(/^mật khẩu/i);
      const confirmInput = screen.getByLabelText(/xác nhận mật khẩu/i);
      const submitBtn = screen.getByRole('button', { name: /tạo tài khoản/i });

      // Invalid student email (not matching ^1124[0-9]{4}@st\.neu\.edu\.vn$)
      fireEvent.change(nameInput, { target: { value: 'Nguyễn Văn Test' } });
      fireEvent.change(emailInput, { target: { value: 'invalid_student@gmail.com' } });
      fireEvent.change(passwordInput, { target: { value: 'SecurePass123!' } });
      fireEvent.change(confirmInput, { target: { value: 'SecurePass123!' } });

      fireEvent.click(submitBtn);

      expect(
        await screen.findByText(/Email sinh viên NEU phải có định dạng/i)
      ).toBeDefined();
    });

    it('validates password minimum length and mismatch', async () => {
      render(
        <MemoryRouter initialEntries={['/dang-ky']}>
          <RegisterPage />
        </MemoryRouter>
      );

      const nameInput = screen.getByLabelText(/họ và tên/i);
      const emailInput = screen.getByLabelText(/địa chỉ email/i);
      const passwordInput = screen.getByLabelText(/^mật khẩu/i);
      const confirmInput = screen.getByLabelText(/xác nhận mật khẩu/i);
      const submitBtn = screen.getByRole('button', { name: /tạo tài khoản/i });

      fireEvent.change(nameInput, { target: { value: 'Nguyễn Văn Test' } });
      fireEvent.change(emailInput, { target: { value: '11240001@st.neu.edu.vn' } });
      fireEvent.change(passwordInput, { target: { value: 'short' } });
      fireEvent.change(confirmInput, { target: { value: 'short' } });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/Mật khẩu phải có độ dài tối thiểu 12 ký tự/i)).toBeDefined();

      fireEvent.change(passwordInput, { target: { value: 'Password123!' } });
      fireEvent.change(confirmInput, { target: { value: 'Different123!' } });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/Mật khẩu xác nhận không khớp/i)).toBeDefined();
    });

    it('submits valid student registration, renders guidance card, and allows resend verification', async () => {
      const registerSpy = vi.spyOn(authService, 'register').mockResolvedValue({
        id: 'acc-123',
        email: '11240001@st.neu.edu.vn',
        display_name: 'Sinh Viên Chuẩn',
        requested_role: 'student',
        email_verified: false,
      });

      const resendSpy = vi.spyOn(authService, 'resendVerification').mockResolvedValue(undefined as unknown as void);

      render(
        <MemoryRouter initialEntries={['/dang-ky']}>
          <RegisterPage />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/họ và tên/i), { target: { value: 'Sinh Viên Chuẩn' } });
      fireEvent.change(screen.getByLabelText(/địa chỉ email/i), { target: { value: '11240001@st.neu.edu.vn' } });
      fireEvent.change(screen.getByLabelText(/^mật khẩu/i), { target: { value: 'Password123!' } });
      fireEvent.change(screen.getByLabelText(/xác nhận mật khẩu/i), { target: { value: 'Password123!' } });

      vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }));
      });

      expect(registerSpy).toHaveBeenCalledWith({
        display_name: 'Sinh Viên Chuẩn',
        email: '11240001@st.neu.edu.vn',
        password: 'Password123!',
        requested_role: 'student',
      });

      // Guidance card rendered
      expect(screen.getByText(/Đăng ký tài khoản thành công!/i)).toBeDefined();
      expect(screen.getByText('11240001@st.neu.edu.vn')).toBeDefined();
      expect(screen.getByText(/tự động được cấp quyền Sinh viên/i)).toBeDefined();

      expect(screen.getByRole('button', { name: /gửi lại thư xác minh/i })).toBeDisabled();
      // Advance in steps so React installs each next tick.
      for (let i = 0; i < 60; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      }
      // Click resend verification
      const resendBtn = screen.getByRole('button', { name: /Gửi lại email xác minh/i });
      await act(async () => {
        fireEvent.click(resendBtn);
      });

      expect(resendSpy).toHaveBeenCalledWith({ email: '11240001@st.neu.edu.vn' });
      expect(screen.getByText(/Đã tiếp nhận yêu cầu gửi lại thư xác minh/i)).toBeDefined();
    });

    it('submits teacher registration with standard email and displays teacher approval note', async () => {
      const registerSpy = vi.spyOn(authService, 'register').mockResolvedValue({
        id: 'acc-456',
        email: 'giangvien@neu.edu.vn',
        display_name: 'TS. Nguyễn Văn Giảng',
        requested_role: 'teacher',
        email_verified: false,
      });

      render(
        <MemoryRouter initialEntries={['/dang-ky']}>
          <RegisterPage />
        </MemoryRouter>
      );

      // Select teacher role
      fireEvent.click(screen.getByRole('radio', { name: /giảng viên/i }));

      fireEvent.change(screen.getByLabelText(/họ và tên/i), { target: { value: 'TS. Nguyễn Văn Giảng' } });
      fireEvent.change(screen.getByLabelText(/địa chỉ email/i), { target: { value: 'giangvien@neu.edu.vn' } });
      fireEvent.change(screen.getByLabelText(/^mật khẩu/i), { target: { value: 'TeacherPass123!' } });
      fireEvent.change(screen.getByLabelText(/xác nhận mật khẩu/i), { target: { value: 'TeacherPass123!' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }));
      });

      expect(registerSpy).toHaveBeenCalledWith({
        display_name: 'TS. Nguyễn Văn Giảng',
        email: 'giangvien@neu.edu.vn',
        password: 'TeacherPass123!',
        requested_role: 'teacher',
      });

      expect(await screen.findByText(/yêu cầu vai trò Giảng viên sẽ được chuyển/i)).toBeDefined();
    });

    it('displays server error message when registration fails (e.g. 409 email already registered)', async () => {
      vi.spyOn(authService, 'register').mockRejectedValue(
        new ApiError(409, { code: 'conflict', message: 'Địa chỉ email này đã được sử dụng.' })
      );

      render(
        <MemoryRouter initialEntries={['/dang-ky']}>
          <RegisterPage />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/họ và tên/i), { target: { value: 'Test Duplicate' } });
      fireEvent.change(screen.getByLabelText(/địa chỉ email/i), { target: { value: '11240002@st.neu.edu.vn' } });
      fireEvent.change(screen.getByLabelText(/^mật khẩu/i), { target: { value: 'Password123!' } });
      fireEvent.change(screen.getByLabelText(/xác nhận mật khẩu/i), { target: { value: 'Password123!' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /tạo tài khoản/i }));
      });

      expect(await screen.findByText('Địa chỉ email này đã được sử dụng.')).toBeDefined();
    });
  });

  // =========================================================================
  // 2. VerifyEmailPage
  // =========================================================================
  describe('VerifyEmailPage Component', () => {
    it('shows guidance and resend form when URL has no token', async () => {
      vi.spyOn(authService, 'verifyEmail');
      render(
        <MemoryRouter initialEntries={['/verify-email']}>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      expect(await screen.findByText(/Kích hoạt tài khoản NEU LMS/i)).toBeDefined();
      expect(authService.verifyEmail).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/Địa chỉ email đã đăng ký/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /Gửi lại thư xác minh/i })).toBeDefined();
    });

    it('extracts token from hash fragment, calls verifyEmail, and displays student auto-grant', async () => {
      const verifySpy = vi.spyOn(authService, 'verifyEmail').mockResolvedValue({
        email: '11240001@st.neu.edu.vn',
        verified: true,
        granted_roles: ['student'],
      });

      // Simulate hash fragment #token=valid-token-123


      render(
        <MemoryRouter initialEntries={['/verify-email#token=valid-token-123']}>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(verifySpy).toHaveBeenCalledWith({ token: 'valid-token-123' });
      });

      expect(await screen.findByText(/Xác minh email thành công!/i)).toBeDefined();
      expect(screen.getByText(/Đã kích hoạt quyền Sinh viên/i)).toBeDefined();
      expect(screen.getByRole('link', { name: /Đăng nhập vào hệ thống/i })).toBeDefined();

      window.location.hash = '';
    });

    it('extracts token from query param, calls verifyEmail, and displays teacher pending notice', async () => {
      const verifySpy = vi.spyOn(authService, 'verifyEmail').mockResolvedValue({
        email: 'teacher@neu.edu.vn',
        verified: true,
        granted_roles: [],
      });

      render(
        <MemoryRouter initialEntries={['/verify-email?token=teacher-token-456']}>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(verifySpy).toHaveBeenCalledWith({ token: 'teacher-token-456' });
      });

      expect(await screen.findByText(/Xác minh email thành công!/i)).toBeDefined();
      expect(screen.getByText(/Email đã xác minh; quyền truy cập theo trạng thái tài khoản/i)).toBeDefined();
    });

    it('differentiates network error from token invalidation and provides retry button', async () => {
      const verifySpy = vi.spyOn(authService, 'verifyEmail').mockRejectedValue(
        new TypeError('Failed to fetch')
      );

      render(
        <MemoryRouter initialEntries={['/verify-email?token=temp-token']}>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(verifySpy).toHaveBeenCalled();
      });

      expect(await screen.findByText(/Lỗi kết nối mạng/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /Thử lại xác minh/i })).toBeDefined();

      // Click retry
      verifySpy.mockResolvedValueOnce({
        email: 'student@st.neu.edu.vn',
        verified: true,
        granted_roles: ['student'],
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Thử lại xác minh/i }));
      });

      expect(await screen.findByText(/Xác minh email thành công!/i)).toBeDefined();
    });

    it('handles invalid or expired token and displays inline resend verification form', async () => {
      vi.spyOn(authService, 'verifyEmail').mockRejectedValue(
        new ApiError(400, {
          code: 'token_invalid_or_expired',
          message: 'Mã xác minh không hợp lệ hoặc đã hết hạn (24 giờ).',
        })
      );

      const resendSpy = vi.spyOn(authService, 'resendVerification').mockResolvedValue(undefined as unknown as void);

      render(
        <MemoryRouter initialEntries={['/verify-email?token=expired-token']}>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      expect(await screen.findByText(/Xác minh email không thành công/i)).toBeDefined();
      expect(screen.getByText(/Liên kết xác minh không hợp lệ, đã hết hạn/i)).toBeDefined();

      // User enters email to get new token
      const emailInput = screen.getByLabelText(/Địa chỉ email đã đăng ký/i);
      fireEvent.change(emailInput, { target: { value: '11240001@st.neu.edu.vn' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Gửi lại thư xác minh/i }));
      });

      expect(resendSpy).toHaveBeenCalledWith({ email: '11240001@st.neu.edu.vn' });
      expect(await screen.findByText(/Nếu tài khoản đủ điều kiện, thư xác minh sẽ được gửi/i)).toBeDefined();
    });
  });

  // =========================================================================
  // 3. ProfilePage: Grants, Requests, Single Email & Role State
  // =========================================================================
  describe('ProfilePage Role & Identity State', () => {
    const mockTeacherUser: SessionInfo = {
      id: 'acc-teacher-1',
      email: 'teacher@neu.edu.vn',
      display_name: 'TS. Nguyễn Văn Giảng',
      roles: [],
      email_verified: true,
      pending_roles: ['teacher'],
      idle_expires_at: '2026-10-24T12:00:00Z',
      absolute_expires_at: '2026-10-24T18:00:00Z',
    };

    const mockGrants: RoleGrantItem[] = [
      {
        id: 'grant-1',
        role: 'student',
        grant_source: 'verified_student_email',
        granted_at: '2026-10-24T10:00:00Z',
      },
    ];

    const mockRequests: RoleRequestItem[] = [
      {
        id: 'req-teacher-1',
        role: 'teacher',
        status: 'pending',
        requested_at: '2026-10-24T10:05:00Z',
        reviewed_at: null,
        review_reason: 'Registration intent',
      },
    ];

    it('displays single email, verified status, pending teacher banner and ungranted notice', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockTeacherUser,
          });
        }
        if (url.includes('/api/v1/auth/grants')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => [],
          });
        }
        if (url.includes('/api/v1/auth/role-requests')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockRequests,
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
        });
      });

      render(
        <MemoryRouter initialEntries={['/ho-so']}>
          <SessionProvider>
            <NotificationProvider>
              <ProfilePage />
            </NotificationProvider>
          </SessionProvider>
        </MemoryRouter>
      );

      // Verify single email display & policy
      expect(await screen.findByText('teacher@neu.edu.vn')).toBeDefined();
      expect(
        screen.getByText(/Một tài khoản gắn với đúng một địa chỉ email đăng ký/i)
      ).toBeDefined();

      // Verified status
      expect(screen.getByText('Đã xác minh')).toBeDefined();

      // Pending teacher banner
      expect(
        screen.getByText(/Yêu cầu vai trò Giảng viên đang chờ Quản trị viên xét duyệt/i)
      ).toBeDefined();

      // Pending role request listed with cancel button
      expect(await screen.findByText(/^Yêu cầu vai trò$/i)).toBeDefined();
      expect(await screen.findByText('Đang chờ duyệt')).toBeDefined();
      expect(await screen.findByRole('button', { name: /Hủy yêu cầu/i })).toBeDefined();
    });

    it('allows canceling a pending role request', async () => {
      vi.spyOn(authService, 'getGrants').mockResolvedValue([]);
      vi.spyOn(authService, 'getRoleRequests').mockResolvedValue(mockRequests);
      const cancelSpy = vi.spyOn(authService, 'cancelRoleRequest').mockResolvedValue({
        id: 'req-teacher-1',
        role: 'teacher',
        status: 'cancelled',
        requested_at: '2026-10-24T10:05:00Z',
        reviewed_at: null,
        review_reason: '',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockTeacherUser,
      });

      render(
        <MemoryRouter initialEntries={['/ho-so']}>
          <SessionProvider>
            <NotificationProvider>
              <ProfilePage />
            </NotificationProvider>
          </SessionProvider>
        </MemoryRouter>
      );

      await screen.findByText('teacher@neu.edu.vn');
      const cancelBtn = await screen.findByRole('button', { name: /Hủy yêu cầu/i });

      await act(async () => {
        fireEvent.click(cancelBtn);
      });

      expect(cancelSpy).toHaveBeenCalledWith('req-teacher-1');
    });

    it('submits a new role request from profile page', async () => {
      vi.spyOn(authService, 'getGrants').mockResolvedValue(mockGrants);
      vi.spyOn(authService, 'getRoleRequests').mockResolvedValue([]);
      const createRequestSpy = vi.spyOn(authService, 'createRoleRequest').mockResolvedValue({
        id: 'req-teacher-new',
        role: 'teacher',
        status: 'pending',
        requested_at: '2026-10-24T12:00:00Z',
        reviewed_at: null,
        review_reason: '',
      });

      const studentUser: SessionInfo = {
        ...mockTeacherUser,
        roles: ['student'],
        pending_roles: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => studentUser,
      });

      render(
        <MemoryRouter initialEntries={['/ho-so']}>
          <SessionProvider>
            <NotificationProvider>
              <ProfilePage />
            </NotificationProvider>
          </SessionProvider>
        </MemoryRouter>
      );

      await screen.findByText(/Yêu cầu cấp thêm vai trò/i);

      // Select teacher role in dropdown
      const select = screen.getByLabelText(/Chọn vai trò muốn yêu cầu/i);
      fireEvent.change(select, { target: { value: 'teacher' } });

      const submitBtn = screen.getByRole('button', { name: /Gửi yêu cầu/i });
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(createRequestSpy).toHaveBeenCalledWith({ role: 'teacher' });
    });
  });

  // =========================================================================
  // 4. Safe Navigation & No Redirect Loop for Ungranted Accounts
  // =========================================================================
  describe('Safe Navigation & Ungranted Account Boundary', () => {
    it('ensures getRoleDashboardPath returns "/" for null/undefined role without infinite redirect', () => {
      expect(getRoleDashboardPath(null)).toBe('/');
      expect(getRoleDashboardPath(undefined)).toBe('/');
      expect(getRoleDashboardPath('student')).toBe('/sv');
      expect(getRoleDashboardPath('teacher')).toBe('/gv');
      expect(getRoleDashboardPath('admin')).toBe('/ad');
    });

    it('preserves access to /ho-so for authenticated user without active roles', async () => {
      const ungrantedUser: SessionInfo = {
        id: 'acc-pending',
        email: 'newuser@neu.edu.vn',
        display_name: 'Chưa Cấp Quyền',
        roles: [],
        email_verified: true,
        pending_roles: ['teacher'],
        idle_expires_at: '2026-10-24T12:00:00Z',
        absolute_expires_at: '2026-10-24T18:00:00Z',
      };

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ungrantedUser,
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [],
        });
      });

      const LocationTracker = () => {
        const location = useLocation();
        return <output data-testid="current-path">{location.pathname}</output>;
      };

      render(
        <MemoryRouter initialEntries={['/ho-so']}>
          <SessionProvider>
            <NotificationProvider>
              <Routes>
                <Route path="/ho-so" element={<RouteGuard><ProfilePage /></RouteGuard>} />
                <Route path="/404" element={<div>404 Not Found</div>} />
              </Routes>
              <LocationTracker />
            </NotificationProvider>
          </SessionProvider>
        </MemoryRouter>
      );

      await screen.findByText('Chưa Cấp Quyền');
      expect(screen.getByTestId('current-path')).toHaveTextContent('/ho-so');
      expect(screen.queryByText('404 Not Found')).toBeNull();
    });
  });

  // =========================================================================
  // 5. Zero Storage of Tokens / Passwords (Security Hygiene)
  // =========================================================================
  describe('Security Hygiene', () => {
    it('verifies localStorage and sessionStorage never store tokens or passwords', () => {
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('password')).toBeNull();
      expect(sessionStorage.getItem('token')).toBeNull();
      expect(sessionStorage.getItem('password')).toBeNull();
    });
  });

  describe('T06 regression boundaries', () => {
    const user: SessionInfo = {
      id: 'pending-user', email: 'teacher@example.org', display_name: 'Pending Teacher',
      roles: [], email_verified: false, pending_roles: ['teacher'],
      idle_expires_at: '2026-10-24T12:00:00Z',
      absolute_expires_at: '2026-10-24T18:00:00Z',
    };
    const request: RoleRequestItem = {
      id: 'request-1', role: 'teacher', status: 'pending',
      requested_at: '2026-10-24T10:00:00Z', reviewed_at: null, review_reason: '',
    };
    function profile() {
      vi.spyOn(authService, 'getMe').mockResolvedValue(user);
      return render(
        <MemoryRouter initialEntries={['/ho-so']}>
          <SessionProvider><NotificationProvider>
            <RouteGuard><ProfilePage /></RouteGuard>
          </NotificationProvider></SessionProvider>
        </MemoryRouter>
      );
    }
    function registration() {
      render(<MemoryRouter><RegisterPage /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText(/địa chỉ email/i), { target: { value: '11240001@st.neu.edu.vn' } });
      fireEvent.change(screen.getByLabelText(/^mật khẩu/i), { target: { value: 'Password123!' } });
      fireEvent.change(screen.getByLabelText(/xác nhận mật khẩu/i), { target: { value: 'Password123!' } });
    }
    it.each([
      [new ApiError(429, { code: 'rate_limited' }), /quá nhiều yêu cầu đăng ký/i],
      [new TypeError('network'), /Không thể kết nối đến máy chủ/i],
      [new ApiError(403, { code: 'csrf_failed', message: 'Phiên xác thực không hợp lệ.' }), /Phiên xác thực không hợp lệ/i],
    ])('registration displays failure without success or role grant (%s)', async (error, message) => {
      vi.spyOn(authService, 'register').mockRejectedValue(error);
      registration();
      fireEvent.click(screen.getByRole('button', { name: /Tạo tài khoản/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByText(/Đăng ký tài khoản thành công/i)).toBeNull();
    });
    it('does not POST when CSRF bootstrap fails', async () => {
      vi.mocked(authService.getCsrf).mockRejectedValue(new TypeError('offline'));
      const register = vi.spyOn(authService, 'register');
      registration();
      fireEvent.click(screen.getByRole('button', { name: /Tạo tài khoản/i }));
      await screen.findByRole('alert');
      expect(register).not.toHaveBeenCalled();
    });
    it('disables registration while pending and never writes credentials to storage', async () => {
      const storage = vi.spyOn(Storage.prototype, 'setItem');
      let finish!: (value: Awaited<ReturnType<typeof authService.register>>) => void;
      const register = vi.spyOn(authService, 'register').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      registration();
      fireEvent.click(screen.getByRole('button', { name: /Tạo tài khoản/i }));
      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: /Đang khởi tạo/i })).toBeDisabled();
      await act(async () => finish({ id: 'new', email: '11240001@st.neu.edu.vn', display_name: '', requested_role: 'student', email_verified: false }));
      expect(screen.queryByLabelText(/^mật khẩu/i)).toBeNull();
      expect(storage).not.toHaveBeenCalled();
    });
    it('consumes a token once under StrictMode and clears router URL', async () => {
      const verify = vi.spyOn(authService, 'verifyEmail').mockResolvedValue({ email: user.email, verified: true, granted_roles: [] });
      const storage = vi.spyOn(Storage.prototype, 'setItem');
      function Location() {
        const location = useLocation();
        return <output data-testid="url">{location.pathname + location.search + location.hash}</output>;
      }
      render(<React.StrictMode><MemoryRouter initialEntries={['/verify-email?token=secret']}><VerifyEmailPage /><Location /></MemoryRouter></React.StrictMode>);
      await screen.findByText(/Xác minh email thành công!/i);
      expect(verify).toHaveBeenCalledExactlyOnceWith({ token: 'secret' });
      expect(screen.getByTestId('url')).toHaveTextContent(/^\/verify-email$/);
      expect(storage).not.toHaveBeenCalled();
    });
    it.each([
      [429, 'rate_limited', 'Quá nhiều yêu cầu xác minh.'],
      [403, 'csrf_failed', 'Phiên xác thực không hợp lệ.'],
      [401, 'account_inactive', 'Tài khoản đã khóa.'],
    ])('handles verification HTTP %s without claiming success', async (status, code, message) => {
      vi.spyOn(authService, 'verifyEmail').mockRejectedValue(new ApiError(status, { code, message }));
      render(<MemoryRouter initialEntries={['/verify-email#token=secret']}><VerifyEmailPage /></MemoryRouter>);
      expect(await screen.findByRole('alert')).toBeDefined();
      expect(screen.queryByText(/Xác minh email thành công!/i)).toBeNull();
    });
    it('keeps role fetch failure distinct from empty state and supports retry', async () => {
      vi.spyOn(authService, 'getGrants').mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue([]);
      vi.spyOn(authService, 'getRoleRequests').mockResolvedValue([request]);
      profile();
      expect(await screen.findByRole('alert')).toHaveTextContent(/Không thể tải trạng thái vai trò/i);
      expect(screen.queryByText('Chưa có vai trò nào được cấp quyền.')).toBeNull();
      expect(screen.getByRole('button', { name: /^Gửi yêu cầu$/i })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /Thử tải lại vai trò/i }));
      expect(await screen.findByText('Đang chờ duyệt')).toBeDefined();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('keeps the account visible and reports failed global logout truthfully', async () => {
      vi.spyOn(authService, 'getGrants').mockResolvedValue([]);
      vi.spyOn(authService, 'getRoleRequests').mockResolvedValue([]);
      vi.spyOn(authService, 'logoutAll').mockRejectedValue(new TypeError('offline'));
      profile();
      await screen.findByText(user.email);
      fireEvent.click(screen.getByRole('button', { name: /Đăng xuất khỏi tất cả thiết bị/i }));
      await screen.findByText(/Chưa thể xác nhận thu hồi các phiên/i);
      expect(screen.getByText(user.email)).toBeInTheDocument();
      expect(screen.queryByText(/Đã đăng xuất khỏi tất cả/i)).not.toBeInTheDocument();
    });

    it('does not claim an unverified pending teacher has verified email', async () => {
      vi.spyOn(authService, 'getGrants').mockResolvedValue([]);
      vi.spyOn(authService, 'getRoleRequests').mockResolvedValue([request]);
      profile();
      expect(await screen.findByText(/Bạn cần xác minh email trước/i)).toBeDefined();
      expect(screen.queryByText(/Email đã được xác minh/i)).toBeNull();
      await screen.findByText('Đang chờ duyệt');
    });
    it.each(['approved', 'rejected', 'cancelled'] as const)('renders %s role request with no cancel action', async status => {
      vi.spyOn(authService, 'getGrants').mockResolvedValue([]);
      vi.spyOn(authService, 'getRoleRequests').mockResolvedValue([{ ...request, status }]);
      profile();
      await screen.findByLabelText('Danh sách yêu cầu vai trò');
      expect(screen.queryByRole('button', { name: /Hủy yêu cầu/i })).toBeNull();
    });
    it('blocks ungranted workspace access through the actual RouteGuard', async () => {
      vi.spyOn(authService, 'getMe').mockResolvedValue(user);
      render(<MemoryRouter initialEntries={['/gv']}><SessionProvider><Routes>
        <Route path="/gv" element={<RouteGuard allowedRoles={['teacher']}><div>Protected workspace</div></RouteGuard>} />
        <Route path="/404" element={<div>Access unavailable</div>} />
      </Routes></SessionProvider></MemoryRouter>);
      await screen.findByText('Access unavailable');
      expect(screen.queryByText('Protected workspace')).toBeNull();
    });
  });
});
