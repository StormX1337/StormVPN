import type { ApiErrorBody } from '@stormvpn/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: Partial<ApiErrorBody> | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    return new ApiError(
      response.status,
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? response.statusText ?? 'Request failed',
      body?.error?.details,
      body?.error?.requestId,
    );
  }

  /** Field errors from a `validation_error` response, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    const issues =
      (this.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
    return Object.fromEntries(issues.map((issue) => [issue.path, issue.message]));
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
