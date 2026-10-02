import {
  AppError,
  isAppError,
  isTransportError,
  type AppErrorCode,
  type AppErrorReason,
  type ConnectionId,
  type RetryHint,
} from '@loge/api';

import { MissingSecretError } from '../plugin-context';
import type { Logger } from '../ports';
import type { Source } from '../sources';

export { MissingSecretError };

/** One source that could not answer, next to the results that did arrive. */
export interface SourceError {
  readonly connectionId: ConnectionId;
  readonly label: string;
  readonly code: AppErrorCode;
  readonly retry: RetryHint;
  readonly reason?: AppErrorReason;
  readonly message: string;
  /** Not even asked: the password saved for it is no longer on this device. */
  readonly needsPassword?: true;
  /** What was saved from this source stands in for it; this is when it was saved. */
  readonly savedAt?: number;
}

/** A request cancelled by its caller — leaving a screen — which is not a failure. */
export function isAborted(error: unknown): boolean {
  return isTransportError(error) && error.kind === 'aborted';
}

/** Plugins throw `AppError`; anything else is a plugin bug, reported as the source being unavailable. */
export function toAppError(error: unknown, log: Logger): AppError {
  if (isAppError(error)) return error;
  log.warn('provider', 'A source failed without a typed error', { error: String(error) });
  return new AppError('PROVIDER_UNAVAILABLE', 'This source ran into a problem.', { retry: 'backoff', cause: error });
}

export function sourceError(source: Source, error: AppError, savedAt?: number): SourceError {
  return {
    connectionId: source.connection.id,
    label: source.connection.label,
    code: error.code,
    retry: error.retry,
    ...(error.reason ? { reason: error.reason } : {}),
    message: error.message,
    ...(error instanceof MissingSecretError ? { needsPassword: true as const } : {}),
    ...(savedAt === undefined ? {} : { savedAt }),
  };
}
