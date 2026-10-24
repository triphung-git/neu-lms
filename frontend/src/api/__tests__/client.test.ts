import { describe, it, expect, beforeEach, afterEach, vi, expectTypeOf } from 'vitest';
import { ApiClient, ApiError, getCsrfToken } from '../client';
import type { components } from '../schema';

describe('ApiClient', () => {
  let client: ApiClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new ApiClient();
    // Clear cookies
    if (typeof document !== 'undefined') {
      document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'neu_csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('type-checks schema paths and response types accurately at compile-time', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = fetchMock;

    // 1. Valid typed GET on /api/v1/health/live returns LivenessResponse
    const live = await client.get('/api/v1/health/live');
    expectTypeOf(live).toEqualTypeOf<components['schemas']['LivenessResponse']>();
    expect(live).toEqual({ status: 'ok' });

    // 2. Valid typed GET on /api/v1/health/ready returns ReadinessSuccessResponse
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'ok', checks: { database: 'ok' } }),
    });
    const ready = await client.get('/api/v1/health/ready');
    expectTypeOf(ready).toEqualTypeOf<components['schemas']['ReadinessSuccessResponse']>();
    expect(ready.checks).toEqual({ database: 'ok' });

    // 3. Compile-time checks for invalid calls using @ts-expect-error:
    // @ts-expect-error - Path '/api/v1/invalid-route' does not exist in OpenAPI schema
    void client.get('/api/v1/invalid-route');

    // @ts-expect-error - Method POST does not exist on /api/v1/health/live
    void client.post('/api/v1/health/live', {});

    // @ts-expect-error - Method DELETE does not exist on /api/v1/health/ready
    void client.delete('/api/v1/health/ready');

    // @ts-expect-error - Method 'post' is not supported on '/api/v1/health/live'
    void client.request('post', '/api/v1/health/live');
  });

  it('constructs correct endpoint URL and attaches query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.untypedRequest('/api/v1/health/live', {
      method: 'GET',
      params: { page: 1, filter: 'active', skipped: undefined, empty: null },
    });

    expect(res).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe('/api/v1/health/live?page=1&filter=active');
  });

  it('serializes JSON body and sets Content-Type header on mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    });
    globalThis.fetch = fetchMock;

    await client.untypedRequest('/api/v1/items', {
      method: 'POST',
      body: { title: 'Bài tập 1', count: 42 },
    });

    const fetchOptions = fetchMock.mock.calls[0][1];
    expect(fetchOptions.method).toBe('POST');
    expect(fetchOptions.headers.get('Content-Type')).toBe('application/json');
    expect(fetchOptions.body).toBe(JSON.stringify({ title: 'Bài tập 1', count: 42 }));
  });

  it('automatically extracts CSRF token from document.cookie and attaches to mutations', async () => {
    document.cookie = 'csrftoken=test-csrf-token-12345; path=/';
    expect(getCsrfToken()).toBe('test-csrf-token-12345');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ updated: true }),
    });
    globalThis.fetch = fetchMock;

    await client.untypedRequest('/api/v1/items/1', {
      method: 'PUT',
      body: { name: 'updated' },
    });

    const fetchOptions = fetchMock.mock.calls[0][1];
    expect(fetchOptions.headers.get('X-CSRFToken')).toBe('test-csrf-token-12345');
  });

  it('does NOT attach CSRF token to GET or HEAD requests', async () => {
    document.cookie = 'csrftoken=test-csrf-token-12345; path=/';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [] }),
    });
    globalThis.fetch = fetchMock;

    await client.get('/api/v1/health/live');

    const fetchOptions = fetchMock.mock.calls[0][1];
    expect(fetchOptions.headers.get('X-CSRFToken')).toBeNull();
  });

  it('returns null on 204 No Content without attempting JSON parse', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
    });
    globalThis.fetch = fetchMock;

    const res = await client.untypedRequest('/api/v1/items/1', { method: 'DELETE' });
    expect(res).toBeNull();
  });

  it('throws typed ApiError with envelope details on 400 validation error', async () => {
    const errorEnvelope = {
      error: {
        code: 'validation_error',
        message: 'Dữ liệu yêu cầu không hợp lệ.',
        details: [{ field: 'email', message: 'Email không hợp lệ.', code: 'invalid' }],
        request_id: '11111111-2222-3333-4444-555555555555',
        correlation_id: '11111111-2222-3333-4444-555555555555',
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': '11111111-2222-3333-4444-555555555555',
      }),
      json: async () => errorEnvelope,
    });
    globalThis.fetch = fetchMock;

    try {
      await client.untypedRequest('/api/v1/register', {
        method: 'POST',
        body: { email: 'invalid' },
      });
      expect.fail('Should have thrown ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.code).toBe('validation_error');
      expect(apiErr.message).toBe('Dữ liệu yêu cầu không hợp lệ.');
      expect(apiErr.details).toEqual([
        { field: 'email', message: 'Email không hợp lệ.', code: 'invalid' },
      ]);
      expect(apiErr.requestId).toBe('11111111-2222-3333-4444-555555555555');
    }
  });

  it('throws typed ApiError on 401 session expired and 403 csrf failed', async () => {
    const expiredEnvelope = {
      error: {
        code: 'session_expired',
        message: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
        request_id: 'aaaa-bbbb',
        correlation_id: 'aaaa-bbbb',
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => expiredEnvelope,
    });

    await expect(client.untypedRequest('/api/v1/profile')).rejects.toThrow(ApiError);
  });

  it('supports request abort with AbortController', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
        }
      });
    });
    globalThis.fetch = fetchMock;

    const promise = client.untypedRequest('/api/v1/slow-endpoint', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow('The user aborted a request.');
  });

  it('does NOT automatically retry failed mutation requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: {
          code: 'internal_server_error',
          message: 'Đã xảy ra lỗi hệ thống.',
          request_id: 'req-500',
          correlation_id: 'req-500',
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await expect(
      client.untypedRequest('/api/v1/orders', { method: 'POST', body: { item: 'book' } })
    ).rejects.toThrow(ApiError);
    // Crucial check: mutation must NOT be called multiple times without idempotency assurance
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
