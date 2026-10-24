import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import type { UserRole } from '../../shared/kernel/types';

interface RouteGuardProps {
  allowedRoles?: UserRole[];
  children: React.ReactNode;
}

export const RouteGuard: React.FC<RouteGuardProps> = ({ allowedRoles, children }) => {
  const { currentUser, role, isAuthenticated, isInitialized, status, refreshSession } = useSession();
  const location = useLocation();

  if (!isInitialized) {
    return null;
  }

  if (status === 'network-error') {
    return (
      <div className="network-error-fallback" style={{ padding: '2rem', textAlign: 'center' }} role="alert">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Không thể kết nối đến máy chủ</h2>
        <p style={{ color: 'var(--text-muted, #64748b)', marginBottom: '1rem' }}>
          Đã xảy ra lỗi kết nối mạng. Vui lòng kiểm tra lại đường truyền.
        </p>
        <button
          onClick={() => refreshSession()}
          style={{
            padding: '0.5rem 1.25rem',
            background: 'var(--color-primary, #0284c7)',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser) {
    if (location.pathname === '/dang-nhap') {
      return null;
    }
    // Safe internal returnTo only
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/dang-nhap?returnTo=${returnTo}`} replace />;
  }

  if (currentUser.status === 'locked') {
    return <Navigate to="/dang-nhap?error=locked" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    if (!role || !allowedRoles.includes(role)) {
      // Wrong role -> 404 without distinguishing reason (baseline/01 §2)
      return <Navigate to="/404" replace />;
    }
  }

  return <>{children}</>;
};
