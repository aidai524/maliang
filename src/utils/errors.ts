/**
 * Base application error
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, true);
    this.name = 'RateLimitError';
  }
}

export class ConcurrencyLimitError extends AppError {
  constructor(message: string = 'Concurrency limit exceeded') {
    super(message, 'CONCURRENCY_LIMIT_EXCEEDED', 429, true);
    this.name = 'ConcurrencyLimitError';
  }
}

/**
 * Provider errors
 */
export class ProviderError extends AppError {
  constructor(
    message: string,
    public providerCode: string,
    retryable: boolean = true
  ) {
    super(message, 'PROVIDER_ERROR', 500, retryable);
    this.name = 'ProviderError';
  }
}

export class ProviderKeyError extends AppError {
  constructor(message: string = 'No provider key available') {
    super(message, 'NO_PROVIDER_KEY', 503, true);
    this.name = 'ProviderKeyError';
  }
}

export class ProviderKeyCooldownError extends AppError {
  constructor(keyId: string, cooldownUntil: number) {
    super(
      `Provider key ${keyId} is in cooldown until ${new Date(cooldownUntil).toISOString()}`,
      'PROVIDER_KEY_COOLDOWN',
      503,
      true
    );
    this.name = 'ProviderKeyCooldownError';
  }
}

/**
 * Job errors
 */
export class JobNotFoundError extends AppError {
  constructor(jobId: string) {
    super(`Job ${jobId} not found`, 'JOB_NOT_FOUND', 404, false);
    this.name = 'JobNotFoundError';
  }
}

export class JobExpiredError extends AppError {
  constructor(jobId: string) {
    super(`Job ${jobId} has expired`, 'JOB_EXPIRED', 410, false);
    this.name = 'JobExpiredError';
  }
}

/**
 * Authentication errors
 */
export class AuthError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401, false);
    this.name = 'AuthError';
  }
}

/**
 * Validation errors
 */
export class ValidationError extends AppError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
    this.name = 'ValidationError';
  }
}

/**
 * Storage errors
 */
export class StorageError extends AppError {
  constructor(message: string) {
    super(message, 'STORAGE_ERROR', 500, true);
    this.name = 'StorageError';
  }
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }

  // Check for common retryable error patterns
  const str = String(error);
  const retryablePatterns = [
    /ECONNRESET/,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /timeout/i,
    /429/i,
    /502/i,
    /503/i,
    /504/i,
    /rate.?limit/i,
  ];

  return retryablePatterns.some(pattern => pattern.test(str));
}

/**
 * Get error code from unknown error
 */
export function getErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  return 'UNKNOWN_ERROR';
}

/**
 * Get error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
