import { AppError, type TransportError } from '@loge/api';

/** A request that got no response. An abort is the caller's own, and goes back to it as it came. */
export function transportError(error: TransportError): AppError | TransportError {
  switch (error.kind) {
    case 'aborted':
      return error;
    case 'offline':
      return new AppError('OFFLINE', 'There is no network connection.', { retry: 'network-change', cause: error });
    case 'unreachable':
      return new AppError('PROVIDER_UNAVAILABLE', 'Your server cannot be reached.', { retry: 'backoff', cause: error });
    case 'timeout':
      return new AppError('TIMEOUT', 'Your server took too long to answer.', { retry: 'backoff', cause: error });
  }
}

/** What a status means on any route. Routes that give 400, 401, 403 or 429 a meaning of their own read those first. */
export function statusError(status: number): AppError {
  if (status === 404) return new AppError('NOT_FOUND', 'There is no Foyer server at this address.', { retry: 'never' });
  if (status === 429) return tooManyTries('backoff');
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'Your server ran into a problem.', { retry: 'backoff' });
  if (status === 400 || status === 413) {
    return new AppError('INVALID_STATE', 'Your server refused what this app sent. One of them may need updating.', { retry: 'never' });
  }
  return new AppError('PROVIDER_UNAVAILABLE', `Your server refused the request (${status}).`, { retry: 'never' });
}

export function unreadable(): AppError {
  return new AppError('PROVIDER_UNAVAILABLE', 'Your server sent an answer that could not be read.', { retry: 'backoff' });
}

export function noPassword(): AppError {
  return new AppError('UNAUTHORIZED', 'Enter the account’s password to sign in.', { retry: 'never' });
}

export function refused(): AppError {
  return new AppError('UNAUTHORIZED', 'Your server did not accept this username and password.', { retry: 'never' });
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

/** Refusals of a new account, in the words the form shows. */
export function notCreated(why: 'invite' | 'taken' | 'username' | 'password'): AppError {
  const message = {
    invite: 'That invite code is used, expired or unknown — or the server takes no new accounts. Make a new code with its invite command.',
    taken: 'That username is taken on this server.',
    username: 'A username is 3 to 50 letters, digits, dots, dashes and underscores, starting with a letter or a digit.',
    password: 'Use at least 8 characters for the account’s password.',
  }[why];
  return new AppError('INVALID_STATE', message, { retry: 'never' });
}
