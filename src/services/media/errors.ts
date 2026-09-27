import {
  AppError,
  isAppError,
  isTransportError,
  type AppErrorCode,
  type AppErrorReason,
  type ConnectionId,
  type RetryHint,
} from '@sc/api';

import type { Logger } from '../ports';
import type { Source } from '../sources';

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
}

/**
 * A row says a password is saved, and the credential store no longer has it —
 * a backup restored the database but not the keychain. Signing in without it
 * would count as a failed login, and servers lock accounts after a few.
 */
export class MissingSecretError extends AppError {
  constructor() {
    super('UNAUTHORIZED', 'The saved password is no longer on this device.', { retry: 'never' });
    this.name = 'MissingSecretError';
  }
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

export function sourceError(source: Source, error: AppError): SourceError {
  return {
    connectionId: source.connection.id,
    label: source.connection.label,
    code: error.code,
    retry: error.retry,
    ...(error.reason ? { reason: error.reason } : {}),
    message: error.message,
    ...(error instanceof MissingSecretError ? { needsPassword: true as const } : {}),
  };
}
