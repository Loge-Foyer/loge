import { AppError, type TransportError } from '@sc/api';

/** A request that got no response. An abort is the caller's own, and goes back to it as it came. */
export function transportError(error: TransportError): AppError | TransportError {
  switch (error.kind) {
    case 'aborted':
      return error;
    case 'offline':
      return new AppError('OFFLINE', 'There is no network connection.', { retry: 'network-change', cause: error });
    case 'unreachable':
      return new AppError('PROVIDER_UNAVAILABLE', 'The sync server cannot be reached.', { retry: 'backoff', cause: error });
    case 'timeout':
      return new AppError('TIMEOUT', 'The sync server took too long to answer.', { retry: 'backoff', cause: error });
  }
}

/** What a status means on any route. Routes that give 401, 403, 409 or 429 a meaning of their own read those first. */
export function statusError(status: number): AppError {
  if (status === 404) return new AppError('NOT_FOUND', 'There is no Streaming Center sync server at this address.', { retry: 'never' });
  if (status === 429) return tooManyTries('backoff');
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'The sync server ran into a problem.', { retry: 'backoff' });
  if (status === 400 || status === 413) {
    return new AppError('INVALID_STATE', 'The sync server refused what this app sent. It may need updating.', { retry: 'never' });
  }
  return new AppError('PROVIDER_UNAVAILABLE', `The sync server refused the request (${status}).`, { retry: 'never' });
}

export function unreadable(): AppError {
  return new AppError('PROVIDER_UNAVAILABLE', 'The sync server sent an answer that could not be read.', { retry: 'backoff' });
}

/** The server let this device go — revoked, or its account deleted. Only the user signs in again. */
export function signedOut(): AppError {
  return new AppError('UNAUTHORIZED', 'The sync server no longer knows this device. Sign in again.', { retry: 'never', reason: 'signed-out' });
}

export function noPassword(): AppError {
  return new AppError('UNAUTHORIZED', 'Enter the account’s password to sign in.', { retry: 'never' });
}

export function refused(): AppError {
  return new AppError('UNAUTHORIZED', 'The sync server did not accept this username and password.', { retry: 'never' });
}

export function wrongPassword(): AppError {
  return new AppError('UNAUTHORIZED', 'That password isn’t right.', { retry: 'never' });
}

/**
 * Throttled: the password was not even judged. A sign-in waits and may be
 * tried later; an owner check is the user's to try again.
 */
export function tooManyTries(retry: 'backoff' | 'never'): AppError {
  const message = 'Too many tries. Wait a little, then try again.';
  return retry === 'backoff'
    ? new AppError('PROVIDER_UNAVAILABLE', message, { retry, reason: 'too-many-attempts' })
    : new AppError('UNAUTHORIZED', message, { retry, reason: 'too-many-attempts' });
}

export function weakKey(): AppError {
  return new AppError('INVALID_STATE', 'The sync server asked for a weaker key than this app allows.', { retry: 'never' });
}

export function lockedVault(): AppError {
  return new AppError('INVALID_STATE', 'The account’s key could not be opened with this password.', { retry: 'never' });
}

/** Refusals of a new account, in the words the form shows. */
export function notCreated(why: 'invite' | 'taken' | 'username' | 'password'): AppError {
  const message = {
    invite: 'That invite code is used, expired or unknown. Make a new one with sc-sync invite.',
    taken: 'That username is taken on this server.',
    username: 'A username is up to 64 letters, digits, dots, dashes and underscores.',
    password: 'Use at least 10 characters for the account’s password.',
  }[why];
  return new AppError('INVALID_STATE', message, { retry: 'never' });
}
