import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User, UserRole } from '../../shared/kernel/types';
import { storageManager, type StoredSession } from '../../infrastructure/persistence/storage';

interface SessionContextType {
  currentUser: User | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  login: (email: string, password?: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  switchRoleQuick: (role: UserRole) => void;
  updateUserStatus: (status: 'active' | 'locked') => void;
  setDemoPassword: (email: string, password: string) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const currentUserRef = React.useRef<User | null>(null);
  const demoPasswordsRef = React.useRef<Map<string, string>>(new Map());

  currentUserRef.current = currentUser;

  const setDemoPassword = (email: string, password: string) => {
    demoPasswordsRef.current.set(email.trim().toLowerCase(), password);
  };

  const logout = () => {
    storageManager.clearSession();
    setCurrentUser(null);
  };

  useEffect(() => {
    // Check initial session
    const stored = storageManager.getSession();
    const db = storageManager.getDatabase();

    if (stored) {
      const user = db.users.find((u) => u.id === stored.userId);
      if (user && user.status === 'active') {
        setCurrentUser(user);
      } else {
        storageManager.clearSession();
        setCurrentUser(null);
      }
    } else {
      // Clean start: Guest stays unauthenticated guest per baseline
      setCurrentUser(null);
    }
    setIsInitialized(true);

    // Subscribe to DB updates
    const unsubscribe = storageManager.subscribe((updatedDb) => {
      const activeUser = currentUserRef.current;
      if (activeUser) {
        const fresh = updatedDb.users.find((u) => u.id === activeUser.id);
        if (fresh) {
          if (fresh.status === 'locked') {
            logout();
          } else if (
            fresh.role !== activeUser.role ||
            fresh.status !== activeUser.status ||
            fresh.fullName !== activeUser.fullName
          ) {
            setCurrentUser(fresh);
          }
        }
      }
    });

    return unsubscribe;
  }, []);

  const login = async (email: string, password?: string): Promise<{ success: boolean; message?: string }> => {
    const db = storageManager.getDatabase();
    const normalized = email.trim().toLowerCase();
    const user = db.users.find((u) => u.emailNormalized === normalized);

    if (!user) {
      return { success: false, message: 'Email hoặc mật khẩu không chính xác.' };
    }

    if (user.status === 'locked') {
      return { success: false, message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.' };
    }

    // Verify password: check in-memory custom password or fallback to Demo@1234
    const customPassword = demoPasswordsRef.current.get(normalized);
    const expectedPassword = customPassword || 'Demo@1234';

    if (password !== undefined) {
      if (password !== expectedPassword) {
        return { success: false, message: 'Email hoặc mật khẩu không chính xác.' };
      }
    } else {
      // If password was omitted, require it unless explicit shortcut
      return { success: false, message: 'Vui lòng nhập mật khẩu.' };
    }

    const session: StoredSession = {
      userId: user.id,
      role: user.role,
      fullName: user.fullName,
      email: user.emailNormalized,
    };
    storageManager.saveSession(session);
    setCurrentUser(user);

    // Update lastLoginAt
    user.lastLoginAt = new Date().toISOString();
    storageManager.saveDatabase(db);

    return { success: true };
  };

  const switchRoleQuick = (role: UserRole) => {
    const db = storageManager.getDatabase();
    let target = db.users.find((u) => u.role === role && u.status === 'active');
    if (!target) {
      target = db.users[0];
    }
    const session: StoredSession = {
      userId: target.id,
      role: target.role,
      fullName: target.fullName,
      email: target.emailNormalized,
    };
    storageManager.saveSession(session);
    setCurrentUser(target);
  };

  const updateUserStatus = (status: 'active' | 'locked') => {
    if (currentUser) {
      const db = storageManager.getDatabase();
      const user = db.users.find((u) => u.id === currentUser.id);
      if (user) {
        user.status = status;
        storageManager.saveDatabase(db);
        if (status === 'locked') {
          logout();
        }
      }
    }
  };

  return (
    <SessionContext.Provider
      value={{
        currentUser,
        role: currentUser?.role || null,
        isAuthenticated: Boolean(currentUser),
        isInitialized,
        login,
        logout,
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
