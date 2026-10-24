import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RouteGuard } from '../app/router/RouteGuard';
import { SessionProvider } from '../app/providers/SessionContext';
import { DatabaseProvider } from '../app/providers/DatabaseContext';
import { ClockProvider } from '../app/providers/ClockContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import type { AuthService } from '../api/authService';

const TestApp: React.FC<{
  initialEntries: string[];
  mockService?: AuthService;
}> = ({ initialEntries, mockService }) => {
  return (
    <ClockProvider>
      <DatabaseProvider>
        <SessionProvider service={mockService}>
          <NotificationProvider>
            <MemoryRouter initialEntries={initialEntries}>
              <Routes>
                <Route path="/" element={<div>Trang chủ công khai</div>} />
                <Route path="/dang-nhap" element={<div>Màn hình Đăng nhập</div>} />
                <Route path="/404" element={<div>Màn hình Không tìm thấy 404</div>} />
                <Route
                  path="/sv"
                  element={
                    <RouteGuard allowedRoles={['student']}>
                      <div>Trang sinh viên hợp lệ</div>
                    </RouteGuard>
                  }
                />
                <Route
                  path="/gv"
                  element={
                    <RouteGuard allowedRoles={['teacher']}>
                      <div>Trang giảng viên hợp lệ</div>
                    </RouteGuard>
                  }
                />
                <Route
                  path="/ad"
                  element={
                    <RouteGuard allowedRoles={['admin']}>
                      <div>Trang quản trị hợp lệ</div>
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

describe('Route Guard and Access Control', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'unauthenticated', message: 'Yêu cầu xác thực phiên đăng nhập.' },
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('protects routes and directs unauthenticated users to login', async () => {
    render(<TestApp initialEntries={['/sv']} />);
    const loginScreen = await screen.findByText(/Màn hình Đăng nhập/i);
    expect(loginScreen).toBeDefined();
  });

  it('allows access to public route /dang-nhap without loop', async () => {
    render(<TestApp initialEntries={['/dang-nhap']} />);
    const loginScreen = await screen.findByText(/Màn hình Đăng nhập/i);
    expect(loginScreen).toBeDefined();
  });

  it('renders public route when API encounters network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<TestApp initialEntries={['/']} />);
    const homeScreen = await screen.findByText(/Trang chủ công khai/i);
    expect(homeScreen).toBeDefined();
  });

  it('renders network error fallback on protected route when API is down', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<TestApp initialEntries={['/sv']} />);
    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toBeDefined();
    expect(screen.getByText(/Không thể kết nối đến máy chủ/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Thử lại/i })).toBeDefined();
  });

  it('redirects authenticated student trying to access teacher workspace to 404', async () => {
    const studentService = {
      getMe: vi.fn().mockResolvedValue({
        id: 'std-1',
        email: '11240001@st.neu.edu.vn',
        display_name: 'Nguyễn Văn Sinh Viên',
        roles: ['student'],
        idle_expires_at: '2026-10-24T12:00:00Z',
        absolute_expires_at: '2026-10-24T18:00:00Z',
      }),
      login: vi.fn(),
      logout: vi.fn(),
      logoutAll: vi.fn(),
      changePassword: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      getCsrf: vi.fn(),
    } as unknown as AuthService;

    render(<TestApp initialEntries={['/gv']} mockService={studentService} />);
    const notFound = await screen.findByText(/Màn hình Không tìm thấy 404/i);
    expect(notFound).toBeDefined();
  });
});
