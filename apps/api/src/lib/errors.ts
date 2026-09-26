export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (code = 'unauthorized', message = 'Authentication required') =>
  new AppError(401, code, message);
export const paymentRequired = (code: string, message: string) => new AppError(402, code, message);
export const forbidden = (
  code = 'forbidden',
  message = 'You are not allowed to perform this action',
) => new AppError(403, code, message);
export const notFound = (resource = 'Resource') =>
  new AppError(404, 'not_found', `${resource} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
export const tooManyRequests = (code: string, message: string, retryAfterSeconds?: number) =>
  new AppError(429, code, message, retryAfterSeconds ? { retryAfterSeconds } : undefined);
export const serviceUnavailable = (code: string, message: string) =>
  new AppError(503, code, message);
