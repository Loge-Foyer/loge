import {
  AppError,
  isTransportError,
  type CancelSignal,
  type HttpMethod,
  type HttpResponse,
  type MediaContext,
} from '@sc/api';

import { readAuthentication } from './dto';
import { statusError, transportError, unreadable } from './errors';
import { fnv1a64 } from './hash';
import { queryString, type QueryValue } from './url';

// A server on the home network answers within moments or not at all; one out
// on the internet gets the benefit of the doubt.
const LOCAL_TIMEOUT_MS = 6_000;
const REMOTE_TIMEOUT_MS = 20_000;

interface Session {
  readonly token: string;
  readonly userId: string;
}

export interface JellyfinClient {
  /** The signed-in server user, signing in first when needed. */
  userId(signal?: CancelSignal): Promise<string>;
  /** An authenticated GET, parsed as JSON. */
  get(path: string, params: Readonly<Record<string, QueryValue>>, signal?: CancelSignal): Promise<unknown>;
  /** An authenticated POST with a JSON body; the answer parsed, or `undefined` when there is none. */
  post(path: string, params: Readonly<Record<string, QueryValue>>, body: unknown, signal?: CancelSignal): Promise<unknown>;
  /** An authenticated DELETE; the answer parsed, or `undefined` when there is none. */
  delete(path: string, params: Readonly<Record<string, QueryValue>>, signal?: CancelSignal): Promise<unknown>;
  /** A GET that needs no sign-in. */
  getPublic(path: string, signal?: CancelSignal): Promise<unknown>;
  /** The authorization header for the current session, for images that need one. */
  authorization(): string | undefined;
  /**
   * The current session's token, for a stream address a player fetches itself
   * — a `<video>` element can send no header. Never stored, never logged.
   */
  token(): string | undefined;
}

export interface ClientOptions {
  readonly baseUrl: string;
  readonly username: string;
  readonly localOnly: boolean;
  readonly context: MediaContext;
}

export function createClient({ baseUrl, username, localOnly, context }: ClientOptions): JellyfinClient {
  // Jellyfin keeps one token per device id, so each account on this device
  // gets its own: signing in one profile never ends another's session.
  const deviceId = fnv1a64(`${context.client.installationId}|${username}`);
  let session: Session | undefined;
  let loadingStored: Promise<Session | undefined> | undefined;
  let signingIn: Promise<Session> | undefined;
  // Jellyfin disables an account after repeated failed sign-ins, so a refusal
  // is remembered and never tried again by this client.
  let refused: AppError | undefined;

  const header = (token?: string) =>
    'MediaBrowser ' +
    [
      `Client="${encodeURIComponent(context.client.appName)}"`,
      `Device="${encodeURIComponent(context.client.deviceName)}"`,
      `DeviceId="${encodeURIComponent(deviceId)}"`,
      `Version="${encodeURIComponent(context.client.appVersion)}"`,
      ...(token ? [`Token="${encodeURIComponent(token)}"`] : []),
    ].join(', ');

  const send = async (
    method: HttpMethod,
    path: string,
    options: { params?: Readonly<Record<string, QueryValue>>; body?: string; token?: string; signal?: CancelSignal },
  ): Promise<HttpResponse> => {
    if (localOnly && context.network.current() === 'cellular') {
      throw new AppError('OFFLINE', 'This server is only used on your home network.', {
        retry: 'network-change',
        reason: 'local-network-only',
      });
    }
    try {
      return await context.http.request({
        method,
        url: baseUrl + path + queryString(options.params ?? {}),
        headers: {
          Authorization: header(options.token),
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        timeoutMs: localOnly ? LOCAL_TIMEOUT_MS : REMOTE_TIMEOUT_MS,
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      throw isTransportError(error) ? transportError(error, localOnly) : error;
    }
  };

  const parse = (response: HttpResponse): unknown => {
    try {
      return JSON.parse(response.text);
    } catch {
      throw unreadable();
    }
  };

  const readStored = async (): Promise<Session | undefined> => {
    const raw = await context.session.read();
    if (!raw) return undefined;
    try {
      const stored: unknown = JSON.parse(raw);
      if (typeof stored === 'object' && stored !== null) {
        const { token, userId } = stored as { token?: unknown; userId?: unknown };
        if (typeof token === 'string' && typeof userId === 'string') return { token, userId };
      }
    } catch {
      // A value this client did not write: sign in again.
    }
    return undefined;
  };

  const current = async (): Promise<Session | undefined> => {
    if (session) return session;
    loadingStored ??= readStored();
    session ??= await loadingStored;
    return session;
  };

  // One sign-in at a time, shared by every caller and never cancelled by one
  // of them: a home screen starts several requests at once.
  const signIn = (): Promise<Session> => {
    if (refused) return Promise.reject(refused);
    signingIn ??= (async () => {
      const { password = '' } = await context.credentials.read();
      const response = await send('POST', '/Users/AuthenticateByName', {
        body: JSON.stringify({ Username: username, Pw: password }),
      });
      if (response.status === 401 || response.status === 403) {
        refused = new AppError('UNAUTHORIZED', 'The server did not accept this username and password.', {
          retry: 'never',
        });
        throw refused;
      }
      if (response.status >= 400) throw statusError(response.status);
      const result = readAuthentication(parse(response));
      if (!result) throw unreadable();
      session = { token: result.accessToken, userId: result.userId };
      await context.session.write(JSON.stringify(session));
      return session;
    })().finally(() => {
      signingIn = undefined;
    });
    return signingIn;
  };

  const authorized = async (
    method: HttpMethod,
    path: string,
    params: Readonly<Record<string, QueryValue>>,
    signal: CancelSignal | undefined,
    body?: unknown,
  ): Promise<unknown> => {
    const first = (await current()) ?? (await signIn());
    const request = (token: string) => ({
      params,
      token,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    let response = await send(method, path, request(first.token));
    if (response.status === 401) {
      // Another client on this device may have signed in since: try its token
      // before signing in once more ourselves.
      const stored = await readStored();
      const next = stored && stored.token !== first.token ? stored : await signIn();
      session = next;
      response = await send(method, path, request(next.token));
      if (response.status === 401) {
        session = undefined;
        loadingStored = undefined;
        await context.session.clear();
        throw new AppError('UNAUTHORIZED', 'The server no longer accepts this sign-in.', { retry: 'never' });
      }
    }
    if (response.status >= 400) throw statusError(response.status);
    // Reports answer 204, with nothing to read.
    return response.text.trim() === '' ? undefined : parse(response);
  };

  return {
    userId: async () => ((await current()) ?? (await signIn())).userId,
    get: (path, params, signal) => authorized('GET', path, params, signal),
    post: (path, params, body, signal) => authorized('POST', path, params, signal, body),
    delete: (path, params, signal) => authorized('DELETE', path, params, signal),
    getPublic: async (path, signal) => {
      const response = await send('GET', path, signal ? { signal } : {});
      if (response.status >= 400) throw statusError(response.status);
      return parse(response);
    },
    authorization: () => (session ? header(session.token) : undefined),
    token: () => session?.token,
  };
}
