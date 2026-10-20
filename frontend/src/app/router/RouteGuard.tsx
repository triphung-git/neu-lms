import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import type { UserRole } from '../../shared/kernel/types';

interface RouteGuardProps {
  allowedRoles?: UserRole[];
  children: React.ReactNode;
}

export const RouteGuard: React.FC<RouteGuardProps> = ({ allowedRoles, children }) => {
  const { currentUser, role, isAuthenticated, isInitialized } = useSession();
  const location = useLocation();

  if (!isInitialized) {
    return null;
  }

  if (!isAuthenticated || !currentUser) {
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
