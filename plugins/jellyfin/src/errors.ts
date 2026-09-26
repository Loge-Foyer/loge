import { AppError, type TransportError } from '@sc/api';

/**
 * A request that got no response. A local-only server that cannot be reached
 * is most likely just not on this network, so it waits for the network to
 * change instead of being tried again and again.
 */
export function transportError(error: TransportError, localOnly: boolean): AppError | TransportError {
  const away = localOnly ? ({ retry: 'network-change', reason: 'local-network-only' } as const) : ({ retry: 'backoff' } as const);
  switch (error.kind) {
    case 'aborted':
      return error;
    case 'offline':
      return new AppError('OFFLINE', 'There is no network connection.', { retry: 'network-change', cause: error });
    case 'unreachable':
      return new AppError('PROVIDER_UNAVAILABLE', 'The server cannot be reached.', { ...away, cause: error });
    case 'timeout':
      return new AppError('TIMEOUT', 'The server took too long to answer.', { ...away, cause: error });
  }
}

export function statusError(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError('UNAUTHORIZED', 'The server did not accept this sign-in.', { retry: 'never' });
  }
  if (status === 404) return new AppError('NOT_FOUND', 'The server no longer has this item.');
  if (status === 503) return new AppError('PROVIDER_UNAVAILABLE', 'The server is starting up.', { retry: 'backoff' });
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'The server ran into a problem.', { retry: 'backoff' });
  return new AppError('PROVIDER_UNAVAILABLE', `The server refused the request (${status}).`, { retry: 'never' });
}

export function unreadable(): AppError {
  return new AppError('PROVIDER_UNAVAILABLE', 'The server sent an answer that could not be read.', { retry: 'backoff' });
}
