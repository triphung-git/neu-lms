import { apiClient, type ApiClient } from './client';
import type { components } from './schema';

export type AdminAccountListItem = components['schemas']['AdminAccountListItem'];
export type AdminAccountDetail = components['schemas']['AdminAccountDetail'];
export type AdminAccountRoleItem = components['schemas']['AdminAccountRoleItem'];
export type AdminAccountRoleRequestItem = components['schemas']['AdminAccountRoleRequestItem'];
export type AdminTeacherRequestItem = components['schemas']['AdminTeacherRequestItem'];
export type PaginatedAdminAccountListItemList = components['schemas']['PaginatedAdminAccountListItemList'];
export type PaginatedAdminTeacherRequestItemList = components['schemas']['PaginatedAdminTeacherRequestItemList'];
export type AdminAccountStateResponse = components['schemas']['AdminAccountStateResponse'];
export type AdminAccountRoleGrantResponse = components['schemas']['AdminAccountRoleGrantResponse'];
export type AdminAccountRoleRevokeResponse = components['schemas']['AdminAccountRoleRevokeResponse'];
export type AdminTeacherApprovalResponse = components['schemas']['AdminTeacherApprovalResponse'];
export type AdminTeacherRejectResponse = components['schemas']['AdminTeacherRejectResponse'];
export type AdminPasswordResetResponse = components['schemas']['AdminPasswordResetResponse'];

export interface ListAccountsParams {
  search?: string;
  role?: string;
  is_active?: boolean;
  email_verified?: boolean;
  page?: number;
  page_size?: number;
}

export interface ListTeacherRequestsParams {
  status?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export class AdminService {
  private client: ApiClient;

  constructor(client: ApiClient = apiClient) {
    this.client = client;
  }

  /**
   * List accounts with search, role, status and verification filters plus pagination.
   */
  async listAccounts(params?: ListAccountsParams): Promise<PaginatedAdminAccountListItemList> {
    return await this.client.get('/api/v1/admin/accounts', { params });
  }

  /**
   * Get detailed account profile with active/historical grants and role requests.
   */
  async getAccount(id: string): Promise<AdminAccountDetail> {
    return await this.client.untypedRequest<AdminAccountDetail>(
      `/api/v1/admin/accounts/${encodeURIComponent(id)}`,
      { method: 'GET' }
    );
  }

  /**
   * Update active state of account (lock / unlock).
   * Note: Locking an admin account requires current_password for D02 re-authentication.
   */
  async setAccountState(
    id: string,
    isActive: boolean,
    currentPassword?: string
  ): Promise<AdminAccountStateResponse> {
    return await this.client.untypedRequest<AdminAccountStateResponse>(
      `/api/v1/admin/accounts/${encodeURIComponent(id)}/state`,
      {
        method: 'POST',
        body: {
          is_active: isActive,
          current_password: currentPassword || undefined,
        },
      }
    );
  }

  /**
   * Explicitly lock account.
   */
  async lockAccount(id: string, currentPassword?: string): Promise<AdminAccountStateResponse> {
    return await this.client.untypedRequest<AdminAccountStateResponse>(
      `/api/v1/admin/accounts/${encodeURIComponent(id)}/lock`,
      {
        method: 'POST',
        body: {
          current_password: currentPassword || undefined,
        },
      }
    );
  }

  /**
   * Explicitly unlock account.
   */
  async unlockAccount(id: string): Promise<AdminAccountStateResponse> {
    return await this.client.untypedRequest<AdminAccountStateResponse>(
      `/api/v1/admin/accounts/${encodeURIComponent(id)}/unlock`,
      { method: 'POST' }
    );
  }

  /**
   * Grant admin role to an account (requires D02 re-authentication password).
   */
  async grantAdminRole(id: string, currentPassword: string): Promise<AdminAccountRoleGrantResponse> {
    return await this.client.untypedRequest<AdminAccountRoleGrantResponse>(
      `/api/v1/admin/accounts/${encodeURIComponent(id)}/roles`,
      {
        method: 'POST',
        body: {
          role: 'admin',
          current_password: currentPassword,
        },
      }
    );
  }

  /**
   * Revoke a role grant from an account.
   * Note: Revoking an admin grant requires current_password.
   */
  async revokeRole(
    id: string,
    grantId: string,
    currentPassword?: string
  ): Promise<AdminAccountRoleRevokeResponse> {
    return await this.client.untypedRequest<AdminAccountRoleRevokeResponse>(
      `/api/v1/admin/accounts/${encodeURIComponent(id)}/roles/${encodeURIComponent(grantId)}/revoke`,
      {
        method: 'POST',
        body: {
          current_password: currentPassword || undefined,
        },
      }
    );
  }

  /**
   * Initiate password reset link dispatch for an account (returns 202 Accepted, zero secret).
   */
  async requestPasswordReset(id: string): Promise<AdminPasswordResetResponse> {
    return await this.client.untypedRequest<AdminPasswordResetResponse>(
      `/api/v1/admin/accounts/${encodeURIComponent(id)}/request-reset`,
      { method: 'POST' }
    );
  }

  /**
   * List teacher verification requests queue.
   */
  async listTeacherRequests(
    params?: ListTeacherRequestsParams
  ): Promise<PaginatedAdminTeacherRequestItemList> {
    return await this.client.get('/api/v1/admin/teacher-requests', { params });
  }

  /**
   * Approve a pending teacher request.
   */
  async approveTeacherRequest(id: string): Promise<AdminTeacherApprovalResponse> {
    return await this.client.untypedRequest<AdminTeacherApprovalResponse>(
      `/api/v1/admin/teacher-requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST' }
    );
  }

  /**
   * Reject a pending teacher request.
   */
  async rejectTeacherRequest(id: string): Promise<AdminTeacherRejectResponse> {
    return await this.client.untypedRequest<AdminTeacherRejectResponse>(
      `/api/v1/admin/teacher-requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST' }
    );
  }
}

export const adminService = new AdminService();
