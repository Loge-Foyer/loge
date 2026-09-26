export const APP_ERROR_CODES = [
  'OFFLINE',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'SYNC_CONFLICT',
  'INVALID_STATE',
  'STORAGE_FAILURE',
  'PIN_INVALID',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/**
 * When trying again can help. `backoff`: later, on its own. `network-change`:
 * not until the device's network changes — a home server seen from mobile
 * data. `never`: not without the user — a wrong password among them, because
 * a server may lock the account of a client that keeps trying.
 */
export type RetryHint = 'backoff' | 'network-change' | 'never';

/** Why, where the code alone would mislead. */
export type AppErrorReason = 'local-network-only';

export interface AppErrorOptions {
  readonly retry?: RetryHint;
  readonly reason?: AppErrorReason;
  readonly cause?: unknown;
}

const DEFAULT_RETRY: Readonly<Record<AppErrorCode, RetryHint>> = {
  OFFLINE: 'network-change',
  UNAUTHORIZED: 'never',
  NOT_FOUND: 'never',
  TIMEOUT: 'backoff',
  PROVIDER_UNAVAILABLE: 'backoff',
  SYNC_CONFLICT: 'never',
  INVALID_STATE: 'never',
  STORAGE_FAILURE: 'backoff',
  PIN_INVALID: 'never',
};

/**
 * The only kind of error a plugin or a service lets out. A raw HTTP or
 * transport error reaching the UI is a bug.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retry: RetryHint;
  readonly reason?: AppErrorReason;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.retry = options.retry ?? DEFAULT_RETRY[code];
    if (options.reason) this.reason = options.reason;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
