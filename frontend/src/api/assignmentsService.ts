import { apiClient, getCsrfToken, type ApiClient } from './client';
import type { components } from './schema';

export type AssignmentSummaryItem = components['schemas']['AssignmentSummaryItem'];
export type AssignmentDetail = components['schemas']['AssignmentDetail'];
export type AssignmentCreateRequest = components['schemas']['AssignmentCreateRequestRequest'];
export type AssignmentUpdateRequest = components['schemas']['AssignmentUpdateRequestRequest'];
export type AssignmentPublishRequest = components['schemas']['AssignmentPublishRequestRequest'];
export type AssignmentCloseRequest = components['schemas']['AssignmentCloseRequestRequest'];
export type PaginatedAssignmentSummaryList =
  components['schemas']['PaginatedAssignmentSummaryList'];
export type AssignmentPreview = components['schemas']['AssignmentPreview'];
export type AssignmentStatus = components['schemas']['AssignmentStatusEnum'];
export type StudentAssignmentEligibility =
  components['schemas']['StudentAssignmentEligibility'];
export type AssignmentReopenWindow = components['schemas']['AssignmentReopenWindow'];
export type CreateAssignmentReopenWindowRequest =
  components['schemas']['CreateAssignmentReopenWindowRequest'];

export interface ListAssignmentsParams {
  status?: string;
  chapter_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export class AssignmentsService {
  constructor(private readonly client: ApiClient = apiClient) {}

  private withHeaders(idempotencyKey?: string, ifMatch?: number | string): Record<string, string> {
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRFToken'] = csrf;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (ifMatch !== undefined) headers['If-Match'] = String(ifMatch);
    return headers;
  }

  async listTeacherAssignments(
    courseId: string,
    params?: ListAssignmentsParams,
    options?: { signal?: AbortSignal }
  ): Promise<PaginatedAssignmentSummaryList> {
    return this.client.untypedRequest<PaginatedAssignmentSummaryList>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments`,
      {
        method: 'GET',
        params: params as Record<string, string | number | boolean | null | undefined>,
        signal: options?.signal,
      }
    );
  }

  async listPublishedAssignments(
    courseId: string,
    params?: ListAssignmentsParams,
    options?: { signal?: AbortSignal }
  ): Promise<PaginatedAssignmentSummaryList> {
    return this.client.untypedRequest<PaginatedAssignmentSummaryList>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/published-assignments`,
      {
        method: 'GET',
        params: params as Record<string, string | number | boolean | null | undefined>,
        signal: options?.signal,
      }
    );
  }

  async getTeacherAssignment(
    courseId: string,
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        signal: options?.signal,
      }
    );
  }

  async getAssignment(
    courseId: string,
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.getTeacherAssignment(courseId, id, options);
  }

  async getAssignmentDirect(
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/assignments/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        signal: options?.signal,
      }
    );
  }

  async createAssignment(
    courseId: string,
    data: AssignmentCreateRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments`,
      {
        method: 'POST',
        body: data,
        headers: this.withHeaders(options?.idempotencyKey),
        signal: options?.signal,
      }
    );
  }

  async updateAssignment(
    courseId: string,
    id: string,
    data: AssignmentUpdateRequest,
    options?: { ifMatch?: number | string; idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: data,
        headers: this.withHeaders(options?.idempotencyKey, options?.ifMatch),
        signal: options?.signal,
      }
    );
  }

  async publishAssignment(
    courseId: string,
    id: string,
    data: AssignmentPublishRequest = {},
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/publish`,
      {
        method: 'POST',
        body: data,
        headers: this.withHeaders(options?.idempotencyKey),
        signal: options?.signal,
      }
    );
  }

  async closeAssignment(
    courseId: string,
    id: string,
    data: AssignmentCloseRequest = {
      close_type: 'manual_close',
      reason: '',
      target_type: 'all',
      scope: 'all_actions',
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/close`,
      {
        method: 'POST',
        body: data,
        headers: this.withHeaders(options?.idempotencyKey),
        signal: options?.signal,
      }
    );
  }

  async reopenAssignment(
    courseId: string,
    id: string,
    data: AssignmentCloseRequest = {
      close_type: 'reopen',
      reason: '',
      target_type: 'all',
      scope: 'all_actions',
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/reopen`,
      {
        method: 'POST',
        body: data,
        headers: this.withHeaders(options?.idempotencyKey),
        signal: options?.signal,
      }
    );
  }

  async archiveAssignment(
    courseId: string,
    id: string,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AssignmentDetail> {
    return this.client.untypedRequest<AssignmentDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/archive`,
      {
        method: 'POST',
        headers: this.withHeaders(options?.idempotencyKey),
        signal: options?.signal,
      }
    );
  }

  async previewAssignment(
    courseId: string,
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<AssignmentPreview> {
    return this.client.untypedRequest<AssignmentPreview>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/preview`,
      {
        method: 'GET',
        signal: options?.signal,
      }
    );
  }

  async getStudentEligibility(
    courseId: string,
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<components['schemas']['StudentAssignmentEligibility']> {
    return this.client.untypedRequest<components['schemas']['StudentAssignmentEligibility']>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/eligibility`,
      {
        method: 'GET',
        signal: options?.signal,
      }
    );
  }

  async getStudentEligibilityDirect(
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<components['schemas']['StudentAssignmentEligibility']> {
    return this.client.untypedRequest<components['schemas']['StudentAssignmentEligibility']>(
      `/api/v1/assignments/${encodeURIComponent(id)}/eligibility`,
      {
        method: 'GET',
        signal: options?.signal,
      }
    );
  }

  async listReopenWindows(
    courseId: string,
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<components['schemas']['AssignmentReopenWindow'][]> {
    return this.client.untypedRequest<components['schemas']['AssignmentReopenWindow'][]>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/reopen-windows`,
      {
        method: 'GET',
        signal: options?.signal,
      }
    );
  }

  async createReopenWindow(
    courseId: string,
    id: string,
    data: components['schemas']['CreateAssignmentReopenWindowRequest'],
    options?: { signal?: AbortSignal }
  ): Promise<components['schemas']['AssignmentReopenWindow']> {
    return this.client.untypedRequest<components['schemas']['AssignmentReopenWindow']>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/reopen-windows`,
      {
        method: 'POST',
        body: data,
        headers: this.withHeaders(),
        signal: options?.signal,
      }
    );
  }

  async revokeReopenWindow(
    courseId: string,
    id: string,
    windowId: string,
    options?: { signal?: AbortSignal }
  ): Promise<components['schemas']['AssignmentReopenWindow']> {
    return this.client.untypedRequest<components['schemas']['AssignmentReopenWindow']>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(id)}/reopen-windows/${encodeURIComponent(windowId)}`,
      {
        method: 'DELETE',
        headers: this.withHeaders(),
        signal: options?.signal,
      }
    );
  }
}

export const assignmentsService = new AssignmentsService();
