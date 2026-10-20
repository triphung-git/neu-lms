import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider, useSession } from '../app/providers/SessionContext';
import { DatabaseProvider, useDatabase } from '../app/providers/DatabaseContext';
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

describe('Session Lifecycle and Route Protection', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    storageManager.resetDatabase();
  });

  it('keeps clean visitor in guest state without automatic background login', async () => {
    let sessionData: ReturnType<typeof useSession> | undefined;

    const SessionConsumer: React.FC = () => {
      sessionData = useSession();
      return <div data-testid="status">{sessionData.isInitialized ? 'ready' : 'loading'}</div>;
    };

    render(
      <SessionProvider>
        <SessionConsumer />
      </SessionProvider>
    );

    const statusEl = await screen.findByTestId('status');
    expect(statusEl.textContent).toBe('ready');
    expect(sessionData?.currentUser).toBeNull();
    expect(sessionData?.isAuthenticated).toBe(false);
    expect(sessionData?.role).toBeNull();
  });

  it('preserves deep link and renders protected view when stored session is active', async () => {
    const db = storageManager.getDatabase();
    const studentUser = db.users.find((u) => u.role === 'student' && u.status === 'active')!;

    storageManager.saveSession({
      userId: studentUser.id,
      role: 'student',
      fullName: studentUser.fullName,
      email: studentUser.emailNormalized,
    });

    render(<TestApp initialEntries={['/sv/mon-hoc']} />);

    const courseView = await screen.findByTestId('student-courses');
    expect(courseView).toBeDefined();
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('revokes session immediately when account status is locked in database', async () => {
    const db = storageManager.getDatabase();
    const studentUser = db.users.find((u) => u.role === 'student' && u.status === 'active')!;

    storageManager.saveSession({
      userId: studentUser.id,
      role: 'student',
      fullName: studentUser.fullName,
      email: studentUser.emailNormalized,
    });

    let sessionState: ReturnType<typeof useSession> | undefined;
    let dbOps: ReturnType<typeof useDatabase> | undefined;

    const InspectionComponent: React.FC = () => {
      sessionState = useSession();
      dbOps = useDatabase();
      return <div>User: {sessionState.currentUser ? sessionState.currentUser.fullName : 'Guest'}</div>;
    };

    render(
      <ClockProvider>
        <DatabaseProvider>
          <SessionProvider>
            <InspectionComponent />
          </SessionProvider>
        </DatabaseProvider>
      </ClockProvider>
    );

    expect(sessionState?.currentUser?.id).toBe(studentUser.id);

    // Lock the student account
    act(() => {
      dbOps?.lockAccount(studentUser.id);
    });

    // Session should be revoked
    expect(sessionState?.currentUser).toBeNull();
    expect(sessionState?.isAuthenticated).toBe(false);
  });

  it('allows immediate authentication with newly registered demo password', async () => {
    let sessionOps: ReturnType<typeof useSession> | undefined;

    const AuthTester: React.FC = () => {
      sessionOps = useSession();
      return <div>Ready</div>;
    };

    render(
      <SessionProvider>
        <AuthTester />
      </SessionProvider>
    );

    // Register a custom demo password for teacher
    act(() => {
      sessionOps?.setDemoPassword('giang-vien@example.edu.vn', 'SecretPass@2026');
    });

    // Login with wrong password should fail
    let loginResult = await act(async () => {
      return await sessionOps!.login('giang-vien@example.edu.vn', 'WrongPass');
    });
    expect(loginResult.success).toBe(false);

    // Login with registered secret password should succeed
    loginResult = await act(async () => {
      return await sessionOps!.login('giang-vien@example.edu.vn', 'SecretPass@2026');
    });
    expect(loginResult.success).toBe(true);
    expect(sessionOps?.currentUser?.emailNormalized).toBe('giang-vien@example.edu.vn');
  });
});
