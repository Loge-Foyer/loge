import { AppError, isTransportError, type CancelSignal, type HttpResponse, type PluginContext, type TransportError } from '@sc/api';

const BASE_URL = 'https://api.themoviedb.org/3';
const TIMEOUT_MS = 15_000;

export type QueryValue = string | number | boolean | undefined;

export interface TmdbClient {
  /** A GET, parsed as JSON, with the key attached. */
  get(path: string, params: Readonly<Record<string, QueryValue>>, signal?: CancelSignal): Promise<unknown>;
}

/**
 * The key goes as TMDB takes it: a Read Access Token — a JWT, three parts
 * with dots between — as a bearer header; an API key, 32 hex digits, in the
 * query, which the host's HTTP client never logs.
 */
export function createClient(context: PluginContext): TmdbClient {
  // TMDB locks nothing, but a refused key stays refused until the user types
  // another: asking again with it only adds to the count against this device.
  let refused: AppError | undefined;
  let key: Promise<string> | undefined;

  const send = async (path: string, params: Readonly<Record<string, QueryValue>>, signal?: CancelSignal): Promise<HttpResponse> => {
    if (refused) throw refused;
    key ??= context.credentials.read().then(({ apiKey = '' }) => apiKey.trim());
    const value = await key;
    if (value === '') throw (refused = new AppError('UNAUTHORIZED', 'TMDB needs a key.', { retry: 'never' }));
    const bearer = value.includes('.');
    try {
      return await context.http.request({
        method: 'GET',
        url: BASE_URL + path + queryString(bearer ? params : { ...params, api_key: value }),
        headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${value}` } : {}) },
        timeoutMs: TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw isTransportError(error) ? transportError(error) : error;
    }
  };

  return {
    get: async (path, params, signal) => {
      const response = await send(path, params, signal);
      if (response.status === 401) throw (refused = new AppError('UNAUTHORIZED', 'TMDB did not accept this key.', { retry: 'never' }));
      if (response.status >= 400) throw statusError(response.status);
      try {
        return JSON.parse(response.text) as unknown;
      } catch {
        throw new AppError('PROVIDER_UNAVAILABLE', 'TMDB sent an answer that could not be read.', { retry: 'backoff' });
      }
    },
  };
}

function statusError(status: number): AppError {
  if (status === 404) return new AppError('NOT_FOUND', 'TMDB has no such title.');
  // TMDB counts requests per address, around fifty a second.
  if (status === 429) {
    return new AppError('PROVIDER_UNAVAILABLE', 'TMDB is being asked for too much at once.', { retry: 'backoff', reason: 'too-many-attempts' });
  }
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'TMDB ran into a problem.', { retry: 'backoff' });
  return new AppError('PROVIDER_UNAVAILABLE', `TMDB refused the request (${status}).`, { retry: 'never' });
}

function transportError(error: TransportError): AppError | TransportError {
  switch (error.kind) {
    case 'aborted':
      return error;
    case 'offline':
      return new AppError('OFFLINE', 'There is no network connection.', { retry: 'network-change', cause: error });
    case 'unreachable':
      return new AppError('PROVIDER_UNAVAILABLE', 'TMDB cannot be reached.', { retry: 'backoff', cause: error });
    case 'timeout':
      return new AppError('TIMEOUT', 'TMDB took too long to answer.', { retry: 'backoff', cause: error });
  }
}

/** `?a=1&b=x%20y`, skipping absent values. */
function queryString(params: Readonly<Record<string, QueryValue>>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
