import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { UserRole } from '../../shared/kernel/types';
import {
  authService,
  mapSessionInfoToUser,
  type AuthUser,
  type AuthService,
} from '../../api/authService';
import { ApiError, getCsrfToken } from '../../api/client';

export type SessionStatus = 'initializing' | 'anonymous' | 'authenticated' | 'network-error';

export interface SessionContextType {
  currentUser: AuthUser | null;
  role: UserRole | null;
  roles: UserRole[];
  status: SessionStatus;
  isAuthenticated: boolean;
  isInitialized: boolean;
  login: (email: string, password?: string) => Promise<{ success: boolean; message?: string; role?: UserRole | null }>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  switchRole: (role: UserRole) => boolean;
  refreshSession: () => Promise<void>;
  // Backward-compatible isolated demo stubs:
  switchRoleQuick: (role: UserRole) => void;
  updateUserStatus: (status: 'active' | 'locked') => void;
  setDemoPassword: (email: string, password: string) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export interface SessionProviderProps {
  children: React.ReactNode;
  service?: AuthService;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({ children, service = authService }) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [status, setStatus] = useState<SessionStatus>('initializing');

  const refreshSession = useCallback(async () => {
    try {
      const info = await service.getMe();
      setCurrentUser((prevUser) => {
        const user = mapSessionInfoToUser(info, prevUser?.role);
        setRole(user.role);
        setRoles(user.roles);
        return user;
      });
      setStatus('authenticated');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        // Explicit 401 (unauthenticated, account_inactive, session_revoked, session_expired)
        setCurrentUser(null);
        setRole(null);
        setRoles([]);
        setStatus('anonymous');
      } else {
        // Network failure, 5xx server disruption, or fetch TypeError
        setStatus('network-error');
      }
    }
  }, [service]);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const info = await service.getMe();
        if (!isMounted) return;
        const user = mapSessionInfoToUser(info);
        setCurrentUser(user);
        setRole(user.role);
        setRoles(user.roles);
        setStatus('authenticated');
      } catch (err: unknown) {
        if (!isMounted) return;
        if (err instanceof ApiError && err.status === 401) {
          setCurrentUser(null);
          setRole(null);
          setRoles([]);
          setStatus('anonymous');
        } else {
          // Network failure or backend temporarily unreachable
          setStatus('network-error');
        }
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [service]);

  const login = async (
    email: string,
    password?: string
  ): Promise<{ success: boolean; message?: string; role?: UserRole | null }> => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      return { success: false, message: 'Vui lòng nhập địa chỉ email.' };
    }
    if (!password) {
      return { success: false, message: 'Vui lòng nhập mật khẩu.' };
    }

    try {
      // Ensure CSRF token is present before login mutation
      if (!getCsrfToken()) {
        try {
          await service.getCsrf();
        } catch {
          // Ignore CSRF fetch error if backend emits it directly
        }
      }

      const info = await service.login({ email: trimmedEmail, password });
      const user = mapSessionInfoToUser(info);
      setCurrentUser(user);
      setRole(user.role);
      setRoles(user.roles);
      setStatus('authenticated');

      return { success: true, role: user.role };
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        return { success: false, message: err.message || 'Đăng nhập không thành công.' };
      }
      return {
        success: false,
        message: 'Không thể kết nối đến máy chủ xác thực. Vui lòng kiểm tra lại mạng.',
      };
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await service.logout();
    } catch {
      // Regardless of server network status, locally transition to anonymous
    } finally {
      setCurrentUser(null);
      setRole(null);
      setRoles([]);
      setStatus('anonymous');
    }
  };

  const logoutAll = async (): Promise<void> => {
    try {
      await service.logoutAll();
    } catch {
      // Fallback local cleanup
    } finally {
      setCurrentUser(null);
      setRole(null);
      setRoles([]);
      setStatus('anonymous');
    }
  };

  const switchRole = (targetRole: UserRole): boolean => {
    if (!currentUser || !currentUser.roles.includes(targetRole)) {
      console.warn(`[SessionContext] Không thể chuyển sang vai trò ${targetRole}: vai trò chưa được cấp.`);
      return false;
    }
    setRole(targetRole);
    setCurrentUser((prev) => (prev ? { ...prev, role: targetRole } : null));
    return true;
  };

  // Deprecated isolated demo stubs
  const switchRoleQuick = (targetRole: UserRole) => {
    switchRole(targetRole);
  };

  const updateUserStatus = (_newStatus: 'active' | 'locked') => {
    // No-op in real server-authoritative authentication
  };

  const setDemoPassword = (_email: string, _pwd: string) => {
    // No-op in real server-authoritative authentication
  };

  return (
    <SessionContext.Provider
      value={{
        currentUser,
        role,
        roles,
        status,
        isAuthenticated: status === 'authenticated' && Boolean(currentUser),
        isInitialized: status !== 'initializing',
        login,
        logout,
        logoutAll,
        switchRole,
        refreshSession,
        switchRoleQuick,
        updateUserStatus,
        setDemoPassword,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
};
