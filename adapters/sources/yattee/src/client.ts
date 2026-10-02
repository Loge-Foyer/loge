import {
  AppError,
  encodeBase64,
  encodeUtf8,
  isTransportError,
  type CancelSignal,
  type HttpResponse,
  type MediaContext,
} from '@loge/api';

import { statusError, transportError, unreadable } from './errors';
import { queryString, type QueryValue } from './url';

// yt-dlp extracts on demand behind most of these calls, which can take a
// while on a cold cache — longer than a media server's own database lookup.
const TIMEOUT_MS = 30_000;

export interface YatteeClient {
  /** A GET, parsed as JSON, with the sign-in attached. */
  get(path: string, params: Readonly<Record<string, QueryValue>>, signal?: CancelSignal): Promise<unknown>;
  /** A POST with a JSON body; the answer parsed. */
  post(path: string, body: unknown, signal?: CancelSignal): Promise<unknown>;
  /** A GET that is allowed to be unauthenticated, for `/health` before anything is proven. */
  getOpen(path: string, signal?: CancelSignal): Promise<unknown>;
  /** The base address, for turning a server-relative path into one a player can fetch. */
  readonly baseUrl: string;
  /**
   * The `Authorization` header, for artwork and captions the host fetches
   * itself. Resolved in memory at load time, never stored and never logged.
   */
  authorization(): Promise<string>;
}

export interface ClientOptions {
  readonly baseUrl: string;
  readonly username: string;
  readonly context: MediaContext;
}

export function createClient({ baseUrl, username, context }: ClientOptions): YatteeClient {
  // The server refuses an account after repeated failures the same way a media
  // server does, so a refusal is remembered and never tried again by this
  // client. There is no session to speak of — Basic auth rides every request —
  // so this latch is the whole of the protection.
  let refused: AppError | undefined;
  let header: Promise<string> | undefined;

  const authorization = async (): Promise<string> => {
    // Read once: the credential store is slower than the request that follows,
    // and the values cannot change under a connected provider.
    header ??= (async () => {
      const { password = '' } = await context.credentials.read();
      return `Basic ${encodeBase64(encodeUtf8(`${username}:${password}`))}`;
    })();
    return header;
  };

  const send = async (
    method: 'GET' | 'POST',
    path: string,
    options: { params?: Readonly<Record<string, QueryValue>>; body?: string; open?: true; signal?: CancelSignal },
  ): Promise<HttpResponse> => {
    if (refused && !options.open) throw refused;
    try {
      return await context.http.request({
        method,
        url: baseUrl + path + queryString(options.params ?? {}),
        headers: {
          ...(options.open ? {} : { Authorization: await authorization() }),
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        timeoutMs: TIMEOUT_MS,
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      throw isTransportError(error) ? transportError(error) : error;
    }
  };

  const parse = (response: HttpResponse): unknown => {
    try {
      return JSON.parse(response.text);
    } catch {
      throw unreadable();
    }
  };

  const check = (response: HttpResponse): HttpResponse => {
    if (response.status === 401 || response.status === 403) {
      refused = statusError(response.status);
      throw refused;
    }
    if (response.status >= 400) throw statusError(response.status);
    return response;
  };

  return {
    baseUrl,
    authorization,
    get: async (path, params, signal) =>
      parse(check(await send('GET', path, { params, ...(signal ? { signal } : {}) }))),
    post: async (path, body, signal) =>
      parse(check(await send('POST', path, { body: JSON.stringify(body), ...(signal ? { signal } : {}) }))),
    getOpen: async (path, signal) =>
      parse(check(await send('GET', path, { open: true, ...(signal ? { signal } : {}) }))),
  };
}
