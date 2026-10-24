import type { paths, components } from './schema';

export type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId: string;
  readonly correlationId: string;

  constructor(
    status: number,
    errorData: Partial<ErrorEnvelope['error']> & { message?: string; code?: string }
  ) {
    super(errorData.message || 'Đã xảy ra lỗi API');
    this.name = 'ApiError';
    this.status = status;
    this.code = errorData.code || 'unknown_error';
    this.details = errorData.details ?? undefined;
    this.requestId = errorData.request_id || '';
    this.correlationId = errorData.correlation_id || errorData.request_id || '';
  }
}

export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)(?:csrftoken|neu_csrftoken)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ==============================================================================
// OpenAPI Typed Client Helpers
// ==============================================================================

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

// Filters paths from OpenAPI schema that support method M
export type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends { [K in M]: any }
    ? paths[P][M] extends { responses: any }
      ? P
      : never
    : never;
}[keyof paths];

// Operation definition for a given Path and Method
export type OperationFor<P extends keyof paths, M extends HttpMethod> =
  paths[P] extends { [K in M]: infer Op } ? Op : never;

// Query parameters extracted from schema
export type QueryParamsFor<P extends keyof paths, M extends HttpMethod> =
  OperationFor<P, M> extends { parameters: { query?: infer Q } }
    ? [Q] extends [never]
      ? undefined
      : Q
    : undefined;

// Request body extracted from schema
export type RequestBodyFor<P extends keyof paths, M extends HttpMethod> =
  OperationFor<P, M> extends { requestBody?: never }
    ? undefined
    : OperationFor<P, M> extends { requestBody: { content: { 'application/json': infer B } } }
    ? B
    : OperationFor<P, M> extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B | undefined
    : undefined;

// Successful response data extracted from schema (200, 201, 204)
export type SuccessResponseFor<P extends keyof paths, M extends HttpMethod> =
  OperationFor<P, M> extends { responses: infer Resps }
    ? 200 extends keyof Resps
      ? Resps[200] extends { content: { 'application/json': infer Data } }
        ? Data
        : void
      : 201 extends keyof Resps
      ? Resps[201] extends { content: { 'application/json': infer Data } }
        ? Data
        : void
      : 204 extends keyof Resps
      ? void
      : unknown
    : unknown;

export interface BaseRequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export type TypedRequestOptions<P extends keyof paths, M extends HttpMethod> = BaseRequestOptions &
  ([QueryParamsFor<P, M>] extends [undefined]
    ? { params?: Record<string, string | number | boolean | null | undefined> }
    : { params?: QueryParamsFor<P, M> });

export interface UntypedRequestOptions extends BaseRequestOptions {
  method?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

// ==============================================================================
// Typed ApiClient Class
// ==============================================================================

export class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = '') {
    this.baseURL = baseURL;
  }

  /**
   * Type-safe GET request strictly bound to OpenAPI schema paths and responses.
   */
  get<P extends PathsWithMethod<'get'>>(
    endpoint: P,
    options?: TypedRequestOptions<P, 'get'>
  ): Promise<SuccessResponseFor<P, 'get'>> {
    return this.execute('GET', endpoint, undefined, options);
  }

  /**
   * Type-safe POST request strictly bound to OpenAPI schema paths, bodies, and responses.
   */
  post<P extends PathsWithMethod<'post'>>(
    endpoint: P,
    ...args: [RequestBodyFor<P, 'post'>] extends [undefined]
      ? [body?: never, options?: TypedRequestOptions<P, 'post'>]
      : [body: RequestBodyFor<P, 'post'>, options?: TypedRequestOptions<P, 'post'>]
  ): Promise<SuccessResponseFor<P, 'post'>> {
    const [body, options] = args;
    return this.execute('POST', endpoint, body, options);
  }

  /**
   * Type-safe PUT request strictly bound to OpenAPI schema paths, bodies, and responses.
   */
  put<P extends PathsWithMethod<'put'>>(
    endpoint: P,
    ...args: [RequestBodyFor<P, 'put'>] extends [undefined]
      ? [body?: never, options?: TypedRequestOptions<P, 'put'>]
      : [body: RequestBodyFor<P, 'put'>, options?: TypedRequestOptions<P, 'put'>]
  ): Promise<SuccessResponseFor<P, 'put'>> {
    const [body, options] = args;
    return this.execute('PUT', endpoint, body, options);
  }

  /**
   * Type-safe PATCH request strictly bound to OpenAPI schema paths, bodies, and responses.
   */
  patch<P extends PathsWithMethod<'patch'>>(
    endpoint: P,
    ...args: [RequestBodyFor<P, 'patch'>] extends [undefined]
      ? [body?: never, options?: TypedRequestOptions<P, 'patch'>]
      : [body: RequestBodyFor<P, 'patch'>, options?: TypedRequestOptions<P, 'patch'>]
  ): Promise<SuccessResponseFor<P, 'patch'>> {
    const [body, options] = args;
    return this.execute('PATCH', endpoint, body, options);
  }

  /**
   * Type-safe DELETE request strictly bound to OpenAPI schema paths and responses.
   */
  delete<P extends PathsWithMethod<'delete'>>(
    endpoint: P,
    options?: TypedRequestOptions<P, 'delete'>
  ): Promise<SuccessResponseFor<P, 'delete'>> {
    return this.execute('DELETE', endpoint, undefined, options);
  }

  /**
   * Generic type-safe request method bound to OpenAPI schema.
   */
  request<M extends HttpMethod, P extends PathsWithMethod<M>>(
    method: M,
    endpoint: P,
    options?: TypedRequestOptions<P, M> & { body?: RequestBodyFor<P, M> }
  ): Promise<SuccessResponseFor<P, M>> {
    return this.execute(method.toUpperCase(), endpoint, options?.body, options);
  }

  /**
   * Untyped escape-hatch for external services or custom endpoints outside schema.
   */
  untypedRequest<T = unknown>(endpoint: string, options: UntypedRequestOptions = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    return this.execute(method, endpoint, options.body, options) as Promise<T>;
  }

  private async execute(
    method: string,
    endpoint: string,
    body?: unknown,
    options?: BaseRequestOptions & {
      params?: unknown;
    }
  ): Promise<any> {
    const { params, headers = {}, ...restOptions } = options || {};

    let url = this.baseURL ? `${this.baseURL.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}` : endpoint;

    if (params && typeof params === 'object') {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
      }
    }

    const reqHeaders = new Headers(headers);
    if (!reqHeaders.has('Accept')) {
      reqHeaders.set('Accept', 'application/json');
    }

    const upperMethod = method.toUpperCase();

    // Attach CSRF token on mutation requests for same-origin authentication
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod);
    if (isMutation && !reqHeaders.has('X-CSRFToken')) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        reqHeaders.set('X-CSRFToken', csrfToken);
      }
    }

    let requestBody: BodyInit | undefined;
    if (body !== undefined && body !== null) {
      if (typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        if (!reqHeaders.has('Content-Type')) {
          reqHeaders.set('Content-Type', 'application/json');
        }
        requestBody = JSON.stringify(body);
      } else {
        requestBody = body as BodyInit;
      }
    }

    const fetchOptions: RequestInit = {
      ...restOptions,
      method: upperMethod,
      headers: reqHeaders,
      credentials: restOptions.credentials || 'same-origin',
      body: requestBody,
    };

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      const reqIdHeader = response.headers.get('x-request-id') || '';
      if (isJson) {
        try {
          const errorJson = await response.json();
          if (errorJson && typeof errorJson === 'object') {
            if ('error' in errorJson && errorJson.error) {
              throw new ApiError(response.status, errorJson.error);
            }
            if ('detail' in errorJson && errorJson.detail) {
              throw new ApiError(response.status, {
                code: 'api_error',
                message: String(errorJson.detail),
                request_id: reqIdHeader,
                correlation_id: reqIdHeader,
              });
            }
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
        }
      }
      throw new ApiError(response.status, {
        code: 'http_error',
        message: response.statusText || `Lỗi HTTP ${response.status}`,
        request_id: reqIdHeader,
        correlation_id: reqIdHeader,
      });
    }

    if (isJson) {
      return await response.json();
    }

    return await response.text();
  }
}

export const apiClient = new ApiClient();
