const API_BASE = '/api/v1'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getErrorMessage(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }

  if (Array.isArray(data)) {
    return data.map(getErrorMessage).join('\n')
  }

  if (data && typeof data === 'object') {
    const values = data as Record<string, unknown>

    if (typeof values.detail === 'string') {
      return values.detail
    }

    return Object.entries(values)
      .map(([field, value]) => `${field}: ${getErrorMessage(value)}`)
      .join('\n')
  }

  return 'Yêu cầu không thành công.'
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined
  }

  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  // Không đưa nguyên trang lỗi HTML của server lên giao diện.
  throw new ApiError(
    'Máy chủ trả về phản hồi không hợp lệ. Kiểm tra backend và proxy.',
    response.status,
  )
}

async function getCsrfToken(): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/csrf`, {
    credentials: 'same-origin',
    cache: 'no-store',
  })

  const data = await readResponse(response)

  if (!response.ok) {
    throw new ApiError(getErrorMessage(data), response.status)
  }

  if (
    !data ||
    typeof data !== 'object' ||
    !('csrfToken' in data) ||
    typeof data.csrfToken !== 'string'
  ) {
    throw new ApiError('Không lấy được mã CSRF.', response.status)
  }

  return data.csrfToken
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    body?: unknown
  } = {},
): Promise<T> {
  const method = options.method ?? 'GET'

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (method !== 'GET') {
    headers['X-CSRFToken'] = await getCsrfToken()
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${API_BASE}/${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  })

  const data = await readResponse(response)

  if (!response.ok) {
    throw new ApiError(getErrorMessage(data), response.status)
  }

  return data as T
}