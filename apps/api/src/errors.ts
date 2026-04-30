import type { ApiErrorCode, ApiErrorResponse } from '@image-gen-web/shared';

export function apiError(code: ApiErrorCode, message: string, details?: string): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };
}
