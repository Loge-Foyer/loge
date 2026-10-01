import { AppError, type TransportError } from '@sc/api';

/** A request that got no response. */
export function transportError(error: TransportError): AppError | TransportError {
  switch (error.kind) {
    case 'aborted':
      return error;
    case 'offline':
      return new AppError('OFFLINE', 'There is no network connection.', { retry: 'network-change', cause: error });
    case 'unreachable':
      return new AppError('PROVIDER_UNAVAILABLE', 'The server cannot be reached.', { retry: 'backoff', cause: error });
    case 'timeout':
      return new AppError('TIMEOUT', 'The server took too long to answer.', { retry: 'backoff', cause: error });
  }
}

export function statusError(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError('UNAUTHORIZED', 'The server did not accept this username and password.', { retry: 'never' });
  }
  if (status === 404) return new AppError('NOT_FOUND', 'The server no longer has this video.');
  // yt-dlp is doing the work behind every one of these, and it is rate-limited
  // by the sites it extracts from as much as by the server itself.
  if (status === 429) {
    return new AppError('PROVIDER_UNAVAILABLE', 'The server is being asked for too much at once.', {
      retry: 'backoff',
      reason: 'too-many-attempts',
    });
  }
  if (status === 503) return new AppError('PROVIDER_UNAVAILABLE', 'The server is starting up.', { retry: 'backoff' });
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'The server ran into a problem.', { retry: 'backoff' });
  return new AppError('PROVIDER_UNAVAILABLE', `The server refused the request (${status}).`, { retry: 'never' });
}

export function unreadable(): AppError {
  return new AppError('PROVIDER_UNAVAILABLE', 'The server sent an answer that could not be read.', { retry: 'backoff' });
}
