import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RouteGuard } from '../app/router/RouteGuard';
import { SessionProvider } from '../app/providers/SessionContext';
import { DatabaseProvider } from '../app/providers/DatabaseContext';
import { ClockProvider } from '../app/providers/ClockContext';
import { NotificationProvider } from '../app/providers/NotificationContext';

const TestApp: React.FC<{ initialEntries: string[]; role?: 'admin' | 'teacher' | 'student' }> = ({
  initialEntries,
  role = 'student',
}) => {
  return (
    <ClockProvider>
      <DatabaseProvider>
        <SessionProvider>
          <NotificationProvider>
            <MemoryRouter initialEntries={initialEntries}>
              <Routes>
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
  it('protects routes and directs unauthenticated users to login', () => {
    // Initial session is unauthenticated by default if sessionStorage is empty
    render(<TestApp initialEntries={['/sv']} />);
    expect(screen.getByText(/Màn hình Đăng nhập/i)).toBeDefined();
  });
});
