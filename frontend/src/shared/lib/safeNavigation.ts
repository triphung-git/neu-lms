import type { UserRole } from '../kernel/types';

/**
 * Sanitizes and validates a redirection path to protect against open redirects.
 *
 * Rules:
 * - Must be a relative path starting with a single '/'
 * - Must NOT start with '//' (protocol-relative URL)
 * - Must NOT contain backslashes '\' (which browsers may normalize to '/')
 * - Must NOT contain ':' before '?' or '#' (prevent scheme-like syntax)
 * - Must NOT contain encoded slash/backslash sequences (%2f, %5c)
 * - Must NOT contain control characters or newlines
 * - Never double-decode (to prevent %252f bypasses)
 */
export function getSafeReturnTo(returnTo: string | null | undefined): string | null {
  if (!returnTo || typeof returnTo !== 'string') {
    return null;
  }

  const trimmed = returnTo.trim();
  if (!trimmed) {
    return null;
  }

  // Must start with exactly one '/' and not '//'
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null;
  }

  // Must not contain backslashes anywhere
  if (trimmed.includes('\\')) {
    return null;
  }

  // Check for encoded slash or backslash bypasses (%2f, %5c) case-insensitively
  if (/%(?:2f|5c)/i.test(trimmed)) {
    return null;
  }

  // Must not contain control characters or whitespace
  if (/[\x00-\x1F\x7F\s]/.test(trimmed)) {
    return null;
  }

  // Extract path portion before query or hash to ensure no embedded scheme
  const pathPart = trimmed.split(/[?#]/)[0];
  if (pathPart.includes(':')) {
    return null;
  }

  return trimmed;
}

/**
 * Maps a server-granted user role to its designated dashboard route.
 * Never deduces role from client heuristics or email strings.
 */
export function getRoleDashboardPath(role?: UserRole | null): string {
  if (role === 'admin') return '/ad';
  if (role === 'teacher') return '/gv';
  if (role === 'student') return '/sv';
  return '/';
}
