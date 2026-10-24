import { apiClient, type ApiClient } from './client';
import type { components } from './schema';
import type { User, UserRole } from '../shared/kernel/types';

export type SessionInfo = components['schemas']['SessionInfo'];
export type CredentialsRequest = components['schemas']['CredentialsRequest'];
export type PasswordChangeRequest = components['schemas']['PasswordChangeRequest'];
export type ResetRequestRequest = components['schemas']['ResetRequestRequest'];
export type ResetConfirmRequest = components['schemas']['ResetConfirmRequest'];

export interface AuthUser extends User {
  roles: UserRole[];
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export function mapSessionInfoToUser(info: SessionInfo, preferredRole?: UserRole | null): AuthUser {
  const roles = (info.roles || []) as UserRole[];
  let activeRole: UserRole | null = null;

  if (roles.length > 0) {
    if (preferredRole && roles.includes(preferredRole)) {
      activeRole = preferredRole;
    } else {
      activeRole = roles[0];
    }
  }

  return {
    id: info.id,
    fullName: info.display_name,
    emailNormalized: info.email.toLowerCase(),
    role: activeRole as UserRole, // null/undefined if roles empty
    roles,
    status: 'active',
    code: '',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    idleExpiresAt: info.idle_expires_at,
    absoluteExpiresAt: info.absolute_expires_at,
  };
}

export class AuthService {
  private client: ApiClient;

  constructor(client: ApiClient = apiClient) {
    this.client = client;
  }

  /**
   * Fetch CSRF token and trigger setting of csrftoken cookie.
   */
  async getCsrf(): Promise<void> {
    await this.client.get('/api/v1/auth/csrf');
  }

  /**
   * Log in with credentials and obtain server session.
   */
  async login(credentials: CredentialsRequest): Promise<SessionInfo> {
    return await this.client.post('/api/v1/auth/login', credentials);
  }

  /**
   * Get current authenticated session info.
   */
  async getMe(): Promise<SessionInfo> {
    return await this.client.get('/api/v1/auth/me');
  }

  /**
   * Log out current session.
   */
  async logout(): Promise<void> {
    await this.client.post('/api/v1/auth/logout');
  }

  /**
   * Invalidate all sessions across all devices for current user.
   */
  async logoutAll(): Promise<void> {
    await this.client.post('/api/v1/auth/logout-all');
  }

  /**
   * Change password for authenticated user.
   */
  async changePassword(data: PasswordChangeRequest): Promise<void> {
    await this.client.post('/api/v1/auth/password/change', data);
  }

  /**
   * Request password reset link dispatch via email.
   */
  async requestPasswordReset(data: ResetRequestRequest): Promise<void> {
    await this.client.post('/api/v1/auth/password/request-reset', data);
  }

  /**
   * Confirm password reset with secret token and new password.
   */
  async resetPassword(data: ResetConfirmRequest): Promise<void> {
    await this.client.post('/api/v1/auth/password/reset', data);
  }
}

export const authService = new AuthService();
