import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { getSafeReturnTo, getRoleDashboardPath } from '../shared/lib/safeNavigation';
import { LoginPage } from '../blueprints/identity/pages/LoginPage';
import { ForgotPasswordPage } from '../blueprints/identity/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../blueprints/identity/pages/ResetPasswordPage';
import { ProfilePage } from '../blueprints/identity/pages/ProfilePage';
import { RegisterPage } from '../blueprints/identity/pages/RegisterPage';
import { SessionProvider } from '../app/providers/SessionContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { authService } from '../api/authService';
import { ApiError } from '../api/client';

describe('B03.6 - Identity Pages, Open Redirect Defense & Session Invalidation', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    if (typeof document !== 'undefined') {
      document.cookie = 'csrftoken=test-csrf-token; path=/;';
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Safe returnTo & Role Dashboard Mapping
  // =========================================================================
  describe('Safe Navigation & Open Redirect Defense', () => {
    it('accepts safe internal relative paths', () => {
      expect(getSafeReturnTo('/sv')).toBe('/sv');
      expect(getSafeReturnTo('/gv/mon-hoc?id=123#tab')).toBe('/gv/mon-hoc?id=123#tab');
      expect(getSafeReturnTo('/ad/tai-khoan')).toBe('/ad/tai-khoan');
      expect(getSafeReturnTo('/ho-so')).toBe('/ho-so');
    });

    it('rejects protocol-relative URL attacks (//evil.com)', () => {
      expect(getSafeReturnTo('//evil.com')).toBeNull();
      expect(getSafeReturnTo('//attacker.com/sv')).toBeNull();
      expect(getSafeReturnTo('///evil.com')).toBeNull();
    });

    it('rejects backslash bypass vectors (/\\evil.com, \\\\evil.com)', () => {
      expect(getSafeReturnTo('/\\evil.com')).toBeNull();
      expect(getSafeReturnTo('\\\\evil.com')).toBeNull();
      expect(getSafeReturnTo('/test\\evil.com')).toBeNull();
      expect(getSafeReturnTo('\\evil.com')).toBeNull();
    });

    it('rejects scheme injections and colons in path (javascript:, https:, /redirect:http)', () => {
      expect(getSafeReturnTo('javascript:alert(1)')).toBeNull();
      expect(getSafeReturnTo('https://evil.com')).toBeNull();
      expect(getSafeReturnTo('http://evil.com')).toBeNull();
      expect(getSafeReturnTo('data:text/html,evil')).toBeNull();
      expect(getSafeReturnTo('/redirect:https://evil.com')).toBeNull();
      expect(getSafeReturnTo('/evil:path')).toBeNull();
    });

    it('rejects percent-encoded bypass sequences (%2f, %5c)', () => {
      expect(getSafeReturnTo('/%2fevil.com')).toBeNull();
      expect(getSafeReturnTo('/%2FEVIL.COM')).toBeNull();
      expect(getSafeReturnTo('/%5cevil.com')).toBeNull();
      expect(getSafeReturnTo('/%5CEVIL.COM')).toBeNull();
      expect(getSafeReturnTo('/path%2fmore')).toBeNull();
    });

    it('rejects control characters, newlines, and empty inputs', () => {
      expect(getSafeReturnTo(null)).toBeNull();
      expect(getSafeReturnTo(undefined)).toBeNull();
      expect(getSafeReturnTo('')).toBeNull();
      expect(getSafeReturnTo('   ')).toBeNull();
      expect(getSafeReturnTo('/path\nwith\nnewline')).toBeNull();
      expect(getSafeReturnTo('/path\rwith\rcarriage')).toBeNull();
    });

    it('maps server-granted roles strictly to corresponding dashboard paths', () => {
      expect(getRoleDashboardPath('admin')).toBe('/ad');
      expect(getRoleDashboardPath('teacher')).toBe('/gv');
      expect(getRoleDashboardPath('student')).toBe('/sv');
      expect(getRoleDashboardPath(null)).toBe('/');
      expect(getRoleDashboardPath(undefined)).toBe('/');
    });
  });

  // =========================================================================
  // 2. LoginPage Interaction & Safe Navigation
  // =========================================================================
  describe('LoginPage', () => {
    it('renders login form with accessible labels, inputs, and submit button', () => {
      render(
        <MemoryRouter initialEntries={['/dang-nhap']}>
          <SessionProvider>
            <LoginPage />
          </SessionProvider>
        </MemoryRouter>
      );

      expect(screen.getByLabelText(/địa chỉ email trường cấp/i)).toBeDefined();
      expect(screen.getByLabelText(/^mật khẩu\b/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /^đăng nhập/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /quên mật khẩu/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /thông tin đăng ký/i })).toBeDefined();
    });

    it('displays error on locked account url parameter', () => {
      render(
        <MemoryRouter initialEntries={['/dang-nhap?error=locked']}>
          <SessionProvider>
            <LoginPage />
          </SessionProvider>
        </MemoryRouter>
      );

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Tài khoản của bạn đã bị khóa');
    });

    it('performs login and routes to server-assigned role dashboard', async () => {
      const mockLoginResponse = {
        id: 'user-sv-1',
        email: 'sinh-vien@example.edu.vn',
        display_name: 'Sinh Viên Test',
        roles: ['student'],
        idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
      };

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ error: { code: 'unauthenticated', message: 'Chưa đăng nhập' } }),
          });
        }
        if (url.includes('/api/v1/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockLoginResponse,
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      let currentPath = '';
      const LocationTracker = () => {
        const location = useLocation();
        currentPath = location.pathname;
        return <div data-testid="current-path">{currentPath}</div>;
      };

      render(
        <MemoryRouter initialEntries={['/dang-nhap']}>
          <SessionProvider>
            <Routes>
              <Route path="/dang-nhap" element={<LoginPage />} />
              <Route path="/sv" element={<div>Trang Sinh Viên</div>} />
            </Routes>
            <LocationTracker />
          </SessionProvider>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/địa chỉ email trường cấp/i), {
        target: { value: 'sinh-vien@example.edu.vn' },
      });
      fireEvent.change(screen.getByLabelText(/^mật khẩu\b/i), {
        target: { value: 'Password123!' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^đăng nhập/i }));
      });

      await waitFor(() => {
        expect(currentPath).toBe('/sv');
      });
    });

    it('navigates to safe returnTo path on successful login', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ error: { code: 'unauthenticated' } }),
          });
        }
        if (url.includes('/api/v1/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              id: 'user-gv-1',
              email: 'giang-vien@example.edu.vn',
              display_name: 'Giảng Viên Test',
              roles: ['teacher'],
              idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
              absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
            }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      let currentPath = '';
      const LocationTracker = () => {
        const location = useLocation();
        currentPath = location.pathname;
        return <div>{currentPath}</div>;
      };

      render(
        <MemoryRouter initialEntries={['/dang-nhap?returnTo=%2Fgv%2Fmon-hoc%3Fid%3D456']}>
          <SessionProvider>
            <Routes>
              <Route path="/dang-nhap" element={<LoginPage />} />
              <Route path="/gv/mon-hoc" element={<div>Chi tiết môn học</div>} />
              <Route path="/gv" element={<div>Trang Giảng Viên</div>} />
            </Routes>
            <LocationTracker />
          </SessionProvider>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/địa chỉ email trường cấp/i), {
        target: { value: 'giang-vien@example.edu.vn' },
      });
      fireEvent.change(screen.getByLabelText(/^mật khẩu\b/i), {
        target: { value: 'TeacherPass123!' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^đăng nhập/i }));
      });

      await waitFor(() => {
        expect(currentPath).toBe('/gv/mon-hoc');
      });
    });

    it('neutralizes open redirect attack returnTo and falls back to server-assigned role dashboard', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ error: { code: 'unauthenticated' } }),
          });
        }
        if (url.includes('/api/v1/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              id: 'user-admin-1',
              email: 'quan-tri@example.edu.vn',
              display_name: 'Quản Trị Test',
              roles: ['admin'],
              idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
              absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
            }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      let currentPath = '';
      const LocationTracker = () => {
        const location = useLocation();
        currentPath = location.pathname;
        return <div>{currentPath}</div>;
      };

      // Attacker supplies protocol-relative URL //evil.com/phishing
      render(
        <MemoryRouter initialEntries={['/dang-nhap?returnTo=%2F%2Fevil.com%2Fphishing']}>
          <SessionProvider>
            <Routes>
              <Route path="/dang-nhap" element={<LoginPage />} />
              <Route path="/ad" element={<div>Trang Quản Trị</div>} />
            </Routes>
            <LocationTracker />
          </SessionProvider>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/địa chỉ email trường cấp/i), {
        target: { value: 'quan-tri@example.edu.vn' },
      });
      fireEvent.change(screen.getByLabelText(/^mật khẩu\b/i), {
        target: { value: 'AdminPass123!' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^đăng nhập/i }));
      });

      // Safely redirected to admin role dashboard /ad, never to evil.com
      await waitFor(() => {
        expect(currentPath).toBe('/ad');
      });
    });

    it('displays server error message on invalid credentials', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ error: { code: 'unauthenticated' } }),
          });
        }
        if (url.includes('/api/v1/auth/login')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              detail: 'Email hoặc mật khẩu không chính xác.',
            }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      render(
        <MemoryRouter initialEntries={['/dang-nhap']}>
          <SessionProvider>
            <LoginPage />
          </SessionProvider>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/địa chỉ email trường cấp/i), {
        target: { value: 'wrong@example.edu.vn' },
      });
      fireEvent.change(screen.getByLabelText(/^mật khẩu\b/i), {
        target: { value: 'WrongPassword' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^đăng nhập/i }));
      });

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Email hoặc mật khẩu không chính xác');
    });
  });

  // =========================================================================
  // 3. ForgotPasswordPage Interaction & Non-enumeration
  // =========================================================================
  describe('ForgotPasswordPage', () => {
    it('validates email and displays non-enumerating success card upon submission', async () => {
      const requestResetSpy = vi.spyOn(authService, 'requestPasswordReset').mockResolvedValue(undefined);

      render(
        <MemoryRouter initialEntries={['/quen-mat-khau']}>
          <ForgotPasswordPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Quên mật khẩu')).toBeDefined();

      // Submit invalid email
      fireEvent.change(screen.getByLabelText(/địa chỉ email tài khoản/i), {
        target: { value: 'invalid-email' },
      });
      fireEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }));

      expect(await screen.findByText(/định dạng email không hợp lệ/i)).toBeDefined();
      expect(requestResetSpy).not.toHaveBeenCalled();

      // Submit valid email
      fireEvent.change(screen.getByLabelText(/địa chỉ email tài khoản/i), {
        target: { value: '11240001@st.neu.edu.vn' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }));
      });

      expect(requestResetSpy).toHaveBeenCalledWith({ email: '11240001@st.neu.edu.vn' });

      // Non-enumerating confirmation text
      const successHeading = await screen.findByText(/yêu cầu đã được ghi nhận/i);
      expect(successHeading).toBeDefined();
      expect(screen.getByText(/nếu địa chỉ email/i)).toBeDefined();
      expect(screen.getByRole('link', { name: /quay lại trang đăng nhập/i })).toBeDefined();
    });

    it('handles rate-limiting (429) cleanly with friendly warning', async () => {
      vi.spyOn(authService, 'requestPasswordReset').mockRejectedValue(
        new ApiError(429, { message: 'Rate limit exceeded', code: 'rate_limited' })
      );

      render(
        <MemoryRouter initialEntries={['/quen-mat-khau']}>
          <ForgotPasswordPage />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/địa chỉ email tài khoản/i), {
        target: { value: 'spammer@example.edu.vn' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /gửi liên kết/i }));
      });

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('quá nhiều yêu cầu');
    });
  });

  // =========================================================================
  // 4. ResetPasswordPage Interaction & Token from Fragment
  // =========================================================================
  describe('ResetPasswordPage', () => {
    it('shows missing token warning when URL fragment has no token', () => {
      window.location.hash = '';

      render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <NotificationProvider>
            <ResetPasswordPage />
          </NotificationProvider>
        </MemoryRouter>
      );

      expect(screen.getByText(/thiếu mã xác thực đặt lại mật khẩu/i)).toBeDefined();
      expect(screen.getByRole('link', { name: /yêu cầu liên kết đặt lại mật khẩu mới/i })).toBeDefined();
    });

    it('extracts token from fragment and submits new password to backend', async () => {
      window.location.hash = '#token=sample-reset-token-777';

      const resetSpy = vi.spyOn(authService, 'resetPassword').mockResolvedValue(undefined);

      let currentPath = '';
      const LocationTracker = () => {
        const location = useLocation();
        currentPath = location.pathname;
        return <div>{currentPath}</div>;
      };

      render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <NotificationProvider>
            <Routes>
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/dang-nhap" element={<div>Trang Đăng Nhập</div>} />
            </Routes>
            <LocationTracker />
          </NotificationProvider>
        </MemoryRouter>
      );

      // Form should be rendered because token is present in fragment
      const newPassInput = screen.getByLabelText(/^mật khẩu mới/i);
      const confirmPassInput = screen.getByLabelText(/xác nhận lại mật khẩu mới/i);

      // Validation: password mismatch
      fireEvent.change(newPassInput, { target: { value: 'NewPassword123!' } });
      fireEvent.change(confirmPassInput, { target: { value: 'MismatchPassword!' } });
      fireEvent.click(screen.getByRole('button', { name: /xác nhận đặt lại mật khẩu/i }));

      expect(await screen.findByText(/mật khẩu nhập lại không khớp/i)).toBeDefined();
      expect(resetSpy).not.toHaveBeenCalled();

      // Submit matching password
      fireEvent.change(confirmPassInput, { target: { value: 'NewPassword123!' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /xác nhận đặt lại mật khẩu/i }));
      });

      expect(resetSpy).toHaveBeenCalledWith({
        token: 'sample-reset-token-777',
        new_password: 'NewPassword123!',
      });

      // Token must NOT be stored in localStorage or sessionStorage
      expect(localStorage.getItem('token')).toBeNull();
      expect(sessionStorage.getItem('token')).toBeNull();

      // Redirects to login
      await waitFor(() => {
        expect(currentPath).toBe('/dang-nhap');
      });
    });

    it('handles invalid or expired token error from API cleanly', async () => {
      window.location.hash = '#token=expired-token-888';

      vi.spyOn(authService, 'resetPassword').mockRejectedValue(
        new ApiError(400, {
          message: 'Reset token is invalid, expired, or has already been used.',
          code: 'invalid_token',
        })
      );

      render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <NotificationProvider>
            <ResetPasswordPage />
          </NotificationProvider>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/^mật khẩu mới/i), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByLabelText(/xác nhận lại mật khẩu mới/i), {
        target: { value: 'ValidPassword123!' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /xác nhận đặt lại mật khẩu/i }));
      });

      expect(await screen.findByText(/mã xác thực không hợp lệ hoặc đã hết hạn/i)).toBeDefined();
      expect(screen.getByRole('link', { name: /yêu cầu liên kết đặt lại mật khẩu mới/i })).toBeDefined();
    });
  });

  // =========================================================================
  // 5. ProfilePage Password Change & Logout All
  // =========================================================================
  describe('ProfilePage Password Change & Session Management', () => {
    const mockAuthUser = {
      id: 'usr-prof-test',
      email: 'giang-vien@example.edu.vn',
      display_name: 'TS. Nguyễn Văn A',
      roles: ['teacher'],
      idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
    };

    it('validates password change fields and calls authService.changePassword', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockAuthUser,
      });

      const changePasswordSpy = vi.spyOn(authService, 'changePassword').mockResolvedValue(undefined);
      const logoutSpy = vi.spyOn(authService, 'logout').mockResolvedValue(undefined);

      let currentPath = '';
      const LocationTracker = () => {
        const location = useLocation();
        currentPath = location.pathname;
        return <div>{currentPath}</div>;
      };

      render(
        <MemoryRouter initialEntries={['/ho-so']}>
          <SessionProvider>
            <NotificationProvider>
              <Routes>
                <Route path="/ho-so" element={<ProfilePage />} />
                <Route path="/dang-nhap" element={<div>Trang Đăng Nhập</div>} />
              </Routes>
              <LocationTracker />
            </NotificationProvider>
          </SessionProvider>
        </MemoryRouter>
      );

      // Wait for session to initialize
      await screen.findByText('TS. Nguyễn Văn A');

      // Test identical new password error
      fireEvent.change(screen.getByLabelText(/mật khẩu hiện tại/i), {
        target: { value: 'SameOldPass123!' },
      });
      fireEvent.change(screen.getByLabelText(/^mật khẩu mới/i), {
        target: { value: 'SameOldPass123!' },
      });
      fireEvent.change(screen.getByLabelText(/nhập lại mật khẩu mới/i), {
        target: { value: 'SameOldPass123!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /lưu đổi mật khẩu/i }));

      expect(await screen.findByText(/mật khẩu mới không được trùng với mật khẩu hiện tại/i)).toBeDefined();
      expect(changePasswordSpy).not.toHaveBeenCalled();

      // Submit valid change
      fireEvent.change(screen.getByLabelText(/^mật khẩu mới/i), {
        target: { value: 'BrandNewPass123!' },
      });
      fireEvent.change(screen.getByLabelText(/nhập lại mật khẩu mới/i), {
        target: { value: 'BrandNewPass123!' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /lưu đổi mật khẩu/i }));
      });

      expect(changePasswordSpy).toHaveBeenCalledWith({
        current_password: 'SameOldPass123!',
        new_password: 'BrandNewPass123!',
      });

      // User session should be terminated per security policy, and routed to login
      await waitFor(() => {
        expect(logoutSpy).toHaveBeenCalled();
        expect(currentPath).toBe('/dang-nhap');
      });
    });

    it('executes logoutAll and terminates sessions across all devices', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockAuthUser,
      });

      const logoutAllSpy = vi.spyOn(authService, 'logoutAll').mockResolvedValue(undefined);

      let currentPath = '';
      const LocationTracker = () => {
        const location = useLocation();
        currentPath = location.pathname;
        return <div>{currentPath}</div>;
      };

      render(
        <MemoryRouter initialEntries={['/ho-so']}>
          <SessionProvider>
            <NotificationProvider>
              <Routes>
                <Route path="/ho-so" element={<ProfilePage />} />
                <Route path="/dang-nhap" element={<div>Trang Đăng Nhập</div>} />
              </Routes>
              <LocationTracker />
            </NotificationProvider>
          </SessionProvider>
        </MemoryRouter>
      );

      await screen.findByText('TS. Nguyễn Văn A');

      const logoutAllBtn = screen.getByRole('button', { name: /đăng xuất khỏi tất cả thiết bị/i });
      await act(async () => {
        fireEvent.click(logoutAllBtn);
      });

      expect(logoutAllSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(currentPath).toBe('/dang-nhap');
      });
    });
  });

  // =========================================================================
  // 6. RegisterPage Form Rendering
  // =========================================================================
  describe('RegisterPage Form Rendering', () => {
    it('renders real registration form with student/teacher role choice, email and password inputs', () => {
      render(
        <MemoryRouter initialEntries={['/dang-ky']}>
          <RegisterPage />
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { level: 1, name: /đăng ký tài khoản/i })).toBeDefined();
      expect(screen.getByRole('radio', { name: /sinh viên/i })).toBeDefined();
      expect(screen.getByRole('radio', { name: /giảng viên/i })).toBeDefined();
      expect(screen.getByLabelText(/họ và tên/i)).toBeDefined();
      expect(screen.getByLabelText(/địa chỉ email/i)).toBeDefined();
      expect(screen.getByLabelText(/^mật khẩu/i)).toBeDefined();
      expect(screen.getByLabelText(/xác nhận mật khẩu/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /tạo tài khoản/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /đăng nhập ngay/i })).toBeDefined();
    });
  });
});
