import { isTransportError, TransportError, type CancelSignal, type HttpMethod, type HttpResponse, type PluginContext } from '@loge/api';

import { noPassword, notCreated, refused, statusError, tooManyTries, transportError, unreadable, wrongPassword } from './errors';
import { decodeSession, encodeSession, type LiveSession, type Session } from './session';

const TIMEOUT_MS = 30_000;
// As the server takes them: 3 to 50 characters, starting with a letter or a digit.
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,49}$/;
const MIN_PASSWORD = 8;
const AUTH = '/api/collections/users/auth-with-password';

export interface RequestOptions {
  readonly body?: string;
  readonly signal?: CancelSignal;
}

export interface SignUp {
  readonly invite: string;
  readonly firstProfile: boolean;
}

export interface ServerClient {
  /** A request anyone may make: `info`. */
  open(method: HttpMethod, path: string, options?: RequestOptions): Promise<HttpResponse>;
  /** A request with this device's session, signing in first when there is none. */
  authorized(method: HttpMethod, path: string, options?: RequestOptions): Promise<HttpResponse>;
  /** This device's session, signing in when there is none. */
  live(signal?: CancelSignal): Promise<LiveSession>;
  /** A session good for another 30 days, from the one this device has. */
  refresh(signal?: CancelSignal): Promise<void>;
  /** Checks `password` as the account's, typed again. Throttled and wrong are errors of their own. */
  verify(password: string, signal?: CancelSignal): Promise<void>;
  /** Creates the account these details name, and keeps its session. Tried once. */
  create(signUp: SignUp, signal?: CancelSignal): Promise<LiveSession>;
  /** Forgets this device's session. PocketBase keeps none, so there is nothing to end there. */
  forget(): Promise<void>;
  json(response: HttpResponse): unknown;
}

/**
 * Your server, as one device's account: PocketBase's sign-in and sessions, and
 * the rules around them.
 *
 * - With no session — the first call, or 30 days offline — it signs in once
 *   with the saved password, shared by every caller.
 * - A 401 on a call with a session means the session ended: it expired, or
 *   the password changed. It takes a newer session another provider on this
 *   device saved, or else signs in once more.
 * - A refused sign-in is latched in the session store, and never tried again
 *   by this plugin: only the user, with a new password, signs in again.
 */
export function createClient(options: { readonly baseUrl: string; readonly username: string; readonly context: PluginContext }): ServerClient {
  const { baseUrl, username, context } = options;
  let session: Session | undefined;
  let loading: Promise<Session | undefined> | undefined;
  let signingIn: Promise<LiveSession> | undefined;

  const send = async (method: HttpMethod, path: string, request: RequestOptions & { readonly token?: string }): Promise<HttpResponse> => {
    try {
      return await context.http.request({
        method,
        url: baseUrl + path,
        headers: {
          Accept: 'application/json',
          ...(request.token ? { Authorization: request.token } : {}),
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        timeoutMs: TIMEOUT_MS,
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      throw isTransportError(error) ? transportError(error) : error;
    }
  };

  const json = (response: HttpResponse): unknown => {
    try {
      return JSON.parse(response.text);
    } catch {
      throw unreadable();
    }
  };

  const stored = async () => decodeSession(await context.session.read());

  const current = async (): Promise<Session | undefined> => {
    if (session) return session;
    loading ??= stored();
    // Never over one a sign-in set meanwhile.
    session ??= await loading;
    return session;
  };

  const keep = async (next: Session) => {
    session = next;
    await context.session.write(encodeSession(next));
  };

  /** What signing in, refreshing or signing up answered: PocketBase's `{ token, record }`. */
  const signedIn = async (response: HttpResponse): Promise<LiveSession> => {
    const answer = json(response) as { token?: unknown; record?: { id?: unknown; username?: unknown } } | null;
    const token = answer?.token;
    const record = answer?.record;
    if (typeof token !== 'string' || token === '' || typeof record?.id !== 'string') throw unreadable();
    const next: LiveSession = { kind: 'live', token, accountId: record.id, username: typeof record.username === 'string' ? record.username : username };
    await keep(next);
    return next;
  };

  const passwordOf = async () => (await context.credentials.read()).password ?? '';

  const signIn = (): Promise<LiveSession> => {
    // Shared by every caller, and cancelled by none of them.
    signingIn ??= (async () => {
      // No account can have this name: not worth a request, or a miss.
      if (!USERNAME.test(username)) {
        await keep({ kind: 'refused' });
        throw refused();
      }
      const password = await passwordOf();
      if (password === '') throw noPassword();
      const response = await send('POST', AUTH, { body: JSON.stringify({ identity: username, password }) });
      if (response.status === 400) {
        await keep({ kind: 'refused' });
        throw refused();
      }
      // Throttled, not refused: nothing judged the password, so nothing is latched.
      if (response.status >= 400) throw statusError(response.status);
      return signedIn(response);
    })().finally(() => {
      signingIn = undefined;
    });
    return signingIn;
  };

  const live = async (signal?: CancelSignal): Promise<LiveSession> => {
    const known = await current();
    if (known?.kind === 'refused') throw refused();
    return known ?? (await raced(signIn(), signal));
  };

  const authorized = async (method: HttpMethod, path: string, request: RequestOptions = {}): Promise<HttpResponse> => {
    const first = await live(request.signal);
    const response = await send(method, path, { ...request, token: first.token });
    if (response.status !== 401) return response;
    // Another provider on this device may have signed in since: its session is tried, once.
    const latest = await stored();
    if (latest?.kind === 'live' && latest.token !== first.token) {
      session = latest;
      const again = await send(method, path, { ...request, token: latest.token });
      if (again.status !== 401) return again;
    }
    // The session ended. One sign-in with the saved password; a refusal is latched.
    session = undefined;
    const fresh = await raced(signIn(), request.signal);
    const retried = await send(method, path, { ...request, token: fresh.token });
    if (retried.status === 401) {
      await keep({ kind: 'refused' });
      throw refused();
    }
    return retried;
  };

  return {
    open: (method, path, request = {}) => send(method, path, request),
    authorized,
    live,
    json,

    refresh: async (signal) => {
      const response = await authorized('POST', '/api/collections/users/auth-refresh', signal ? { signal } : {});
      if (response.status >= 400) throw statusError(response.status);
      await signedIn(response);
    },

    verify: async (password, signal) => {
      // Nothing to judge: no request, so it never counts as a miss.
      if (password === '') throw wrongPassword();
      const response = await send('POST', AUTH, { body: JSON.stringify({ identity: username, password }), ...(signal ? { signal } : {}) });
      if (response.status === 200) return;
      if (response.status === 400) throw wrongPassword();
      if (response.status === 429) throw tooManyTries('never');
      throw statusError(response.status);
    },

    create: async ({ invite, firstProfile }, signal) => {
      if (!USERNAME.test(username)) throw notCreated('username');
      const password = await passwordOf();
      if ([...password].length < MIN_PASSWORD) throw notCreated('password');
      const response = await send('POST', '/api/foyer/sign-up', {
        body: JSON.stringify({ username, password, invite, firstProfile }),
        ...(signal ? { signal } : {}),
      });
      if (response.status === 403) throw notCreated('invite');
      if (response.status === 400) throw signUpRefusal(json(response));
      if (response.status >= 400) throw statusError(response.status);
      return signedIn(response);
    },

    forget: async () => {
      session = undefined;
      loading = undefined;
      await context.session.clear();
    },
  };
}

/** What a refused sign-up names: the username, taken or not one, or the password. */
function signUpRefusal(body: unknown) {
  const data = (body as { data?: Readonly<Record<string, { code?: unknown }>> } | null)?.data ?? {};
  if (data.username?.code === 'validation_not_unique') return notCreated('taken');
  if (data.username) return notCreated('username');
  if (data.password) return notCreated('password');
  return statusError(400);
}

/** Waits for shared work, or stops waiting when `signal` aborts — without cancelling it for anyone else. */
function raced<T>(work: Promise<T>, signal: CancelSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new TransportError('aborted'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new TransportError('aborted'));
    signal.addEventListener('abort', abort);
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
