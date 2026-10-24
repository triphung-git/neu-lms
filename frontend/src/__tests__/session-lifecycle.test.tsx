import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider, useSession } from '../app/providers/SessionContext';
import { DatabaseProvider } from '../app/providers/DatabaseContext';
import { ClockProvider } from '../app/providers/ClockContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { RouteGuard } from '../app/router/RouteGuard';
import { storageManager } from '../infrastructure/persistence/storage';

const TestApp: React.FC<{ initialEntries: string[] }> = ({ initialEntries }) => {
  return (
    <ClockProvider>
      <DatabaseProvider>
        <SessionProvider>
          <NotificationProvider>
            <MemoryRouter initialEntries={initialEntries}>
              <Routes>
                <Route path="/dang-nhap" element={<div data-testid="login-page">Trang Đăng Nhập</div>} />
                <Route
                  path="/sv/mon-hoc"
                  element={
                    <RouteGuard allowedRoles={['student']}>
                      <div data-testid="student-courses">Danh sách môn học sinh viên</div>
                    </RouteGuard>
                  }
                />
              </Routes>
            </MemoryRouter>
          </NotificationProvider>
        </SessionProvider>
      </DatabaseProvider>
    </ClockProvider>
  );
};

describe('Session Lifecycle, Server Identity & Route Protection (B03.5)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    storageManager.resetDatabase();
    if (typeof document !== 'undefined') {
      document.cookie = 'csrftoken=mock-csrf-token; path=/;';
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('initializes clean visitor in anonymous state when /me returns 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'unauthenticated', message: 'Yêu cầu xác thực phiên đăng nhập.' },
      }),
    });

    let sessionData: ReturnType<typeof useSession> | undefined;

    const SessionConsumer: React.FC = () => {
      sessionData = useSession();
      return <div data-testid="status">{sessionData.isInitialized ? sessionData.status : 'loading'}</div>;
    };

    render(
      <SessionProvider>
        <SessionConsumer />
      </SessionProvider>
    );

    const statusEl = await screen.findByTestId('status');
    expect(statusEl.textContent).toBe('anonymous');
    expect(sessionData?.currentUser).toBeNull();
    expect(sessionData?.isAuthenticated).toBe(false);
    expect(sessionData?.role).toBeNull();
    expect(sessionData?.roles).toEqual([]);
  });

  it('initializes authenticated user from server /me and preserves deep link', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: '6fe89099-a49e-4627-8460-b5f477830a18',
        email: '11240001@st.neu.edu.vn',
        display_name: 'Nguyễn Văn Sinh Viên',
        roles: ['student'],
        idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
      }),
    });

    render(<TestApp initialEntries={['/sv/mon-hoc']} />);

    const courseView = await screen.findByTestId('student-courses');
    expect(courseView).toBeDefined();
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('handles network failure on /me gracefully with network-error status without redirecting to login', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    let sessionState: ReturnType<typeof useSession> | undefined;

    const SessionConsumer: React.FC = () => {
      sessionState = useSession();
      return (
        <RouteGuard allowedRoles={['student']}>
          <div data-testid="content">Protected Content</div>
        </RouteGuard>
      );
    };

    render(
      <MemoryRouter initialEntries={['/sv/mon-hoc']}>
        <SessionProvider>
          <SessionConsumer />
        </SessionProvider>
      </MemoryRouter>
    );

    const errorEl = await screen.findByRole('alert');
    expect(errorEl.textContent).toContain('Không thể kết nối đến máy chủ');
    expect(sessionState?.status).toBe('network-error');
    // Does NOT redirect to login screen
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('clears session when server returns 401 session_revoked or session_expired', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'session_revoked', message: 'Phiên làm việc đã bị thu hồi.' },
      }),
    });

    let sessionState: ReturnType<typeof useSession> | undefined;

    const SessionConsumer: React.FC = () => {
      sessionState = useSession();
      return <div>Status: {sessionState.status}</div>;
    };

    render(
      <SessionProvider>
        <SessionConsumer />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(sessionState?.status).toBe('anonymous');
    });

    expect(sessionState?.currentUser).toBeNull();
    expect(sessionState?.isAuthenticated).toBe(false);
  });

  it('performs real login and state transition to authenticated', async () => {
    const fetchMock = vi.fn();
    // 1. Initial /me check (anonymous)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'unauthenticated', message: 'Chưa đăng nhập.' },
      }),
    });
    // 2. POST /api/v1/auth/login returns SessionInfo
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'af6e1bdd-c60c-467d-8188-075785a49f00',
        email: 'giang-vien@example.edu.vn',
        display_name: 'TS. Nguyễn Văn Giảng Viên',
        roles: ['teacher'],
        idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
      }),
    });

    globalThis.fetch = fetchMock;

    let sessionOps: ReturnType<typeof useSession> | undefined;

    const AuthTester: React.FC = () => {
      sessionOps = useSession();
      return <div>Status: {sessionOps.status}</div>;
    };

    render(
      <SessionProvider>
        <AuthTester />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(sessionOps?.isInitialized).toBe(true);
    });

    // Execute login
    let loginResult: { success: boolean; message?: string; role?: string | null } | undefined;
    await act(async () => {
      loginResult = await sessionOps!.login('giang-vien@example.edu.vn', 'ValidPassword123!');
    });

    expect(loginResult?.success).toBe(true);
    expect(loginResult?.role).toBe('teacher');
    expect(sessionOps?.isAuthenticated).toBe(true);
    expect(sessionOps?.status).toBe('authenticated');
    expect(sessionOps?.currentUser?.emailNormalized).toBe('giang-vien@example.edu.vn');
    expect(sessionOps?.currentUser?.fullName).toBe('TS. Nguyễn Văn Giảng Viên');
    expect(sessionOps?.role).toBe('teacher');
  });

  it('handles multi-role account and prevents switching to ungranted role', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'user-multi-role',
        email: 'multirole@neu.edu.vn',
        display_name: 'Người dùng Đa vai trò',
        roles: ['teacher', 'student'],
        idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
      }),
    });

    let sessionOps: ReturnType<typeof useSession> | undefined;

    const RoleConsumer: React.FC = () => {
      sessionOps = useSession();
      return <div>Role: {sessionOps.role}</div>;
    };

    render(
      <SessionProvider>
        <RoleConsumer />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(sessionOps?.isInitialized).toBe(true);
    });

    // Initial role is first role ('teacher')
    expect(sessionOps?.role).toBe('teacher');
    expect(sessionOps?.roles).toEqual(['teacher', 'student']);

    // Switch to granted role 'student' -> succeeds
    act(() => {
      const switched = sessionOps?.switchRole('student');
      expect(switched).toBe(true);
    });
    expect(sessionOps?.role).toBe('student');

    // Switch to ungranted role 'admin' -> fails, role stays 'student'
    act(() => {
      const switched = sessionOps?.switchRole('admin');
      expect(switched).toBe(false);
    });
    expect(sessionOps?.role).toBe('student');
  });

  it('does NOT assign student role when account has no roles granted', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'user-no-role',
        email: 'norole@neu.edu.vn',
        display_name: 'Tài khoản chưa có vai trò',
        roles: [],
        idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
      }),
    });

    let sessionOps: ReturnType<typeof useSession> | undefined;

    const NoRoleConsumer: React.FC = () => {
      sessionOps = useSession();
      return <div>Status: {sessionOps.status}</div>;
    };

    render(
      <SessionProvider>
        <NoRoleConsumer />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(sessionOps?.isInitialized).toBe(true);
    });

    expect(sessionOps?.status).toBe('authenticated');
    expect(sessionOps?.roles).toEqual([]);
    expect(sessionOps?.role).toBeNull(); // Strictly null, NEVER falsely assigned student
  });

  it('does NOT recover identity from localStorage seed session', async () => {
    // Attempting to fake a session in localStorage
    storageManager.saveSession({
      userId: 'fake-admin-id',
      role: 'admin',
      fullName: 'Fake Administrator',
      email: 'fake-admin@example.edu.vn',
    });

    // Server returns 401 unauthenticated
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'unauthenticated', message: 'Yêu cầu đăng nhập.' },
      }),
    });

    let sessionState: ReturnType<typeof useSession> | undefined;

    const SessionConsumer: React.FC = () => {
      sessionState = useSession();
      return <div>Status: {sessionState.status}</div>;
    };

    render(
      <SessionProvider>
        <SessionConsumer />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(sessionState?.isInitialized).toBe(true);
    });

    // LocalStorage session is strictly ignored!
    expect(sessionState?.currentUser).toBeNull();
    expect(sessionState?.isAuthenticated).toBe(false);
    expect(sessionState?.status).toBe('anonymous');
  });

  it('performs logout and clears server session locally', async () => {
    const fetchMock = vi.fn();
    // 1. Initial /me (authenticated)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'user-logout-test',
        email: 'user@neu.edu.vn',
        display_name: 'Người dùng Logout',
        roles: ['student'],
        idle_expires_at: new Date(Date.now() + 1800000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 43200000).toISOString(),
      }),
    });
    // 2. POST /api/v1/auth/logout (204)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
    });

    globalThis.fetch = fetchMock;

    let sessionOps: ReturnType<typeof useSession> | undefined;

    const LogoutTester: React.FC = () => {
      sessionOps = useSession();
      return <div>Status: {sessionOps.status}</div>;
    };

    render(
      <SessionProvider>
        <LogoutTester />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(sessionOps?.isAuthenticated).toBe(true);
    });

    // Perform logout
    await act(async () => {
      await sessionOps!.logout();
    });

    expect(sessionOps?.currentUser).toBeNull();
    expect(sessionOps?.role).toBeNull();
    expect(sessionOps?.roles).toEqual([]);
    expect(sessionOps?.status).toBe('anonymous');
    expect(sessionOps?.isAuthenticated).toBe(false);
  });
});
