/** Application error with an HTTP status and stable machine-readable code. */
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

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Insufficient permissions') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Resource not found') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'conflict', msg, details);
export const tooMany = (msg = 'Too many requests') => new AppError(429, 'rate_limited', msg);
export const validationError = (msg: string, details?: unknown) => new AppError(422, 'validation_error', msg, details);
