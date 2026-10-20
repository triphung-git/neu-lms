export type AppErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEADLINE_PASSED'
  | 'COURSE_ARCHIVED'
  | 'QUOTA_EXCEEDED'
  | 'UNAVAILABLE';

export interface AppError {
  code: AppErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(code: AppErrorCode, message: string, fieldErrors?: Record<string, string>): Result<T> {
  return { ok: false, error: { code, message, fieldErrors } };
}
