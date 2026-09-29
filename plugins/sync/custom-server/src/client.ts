import {
  AppError,
  encodeBase64Url,
  isKdfParams,
  isTransportError,
  TransportError,
  type CancelSignal,
  type HttpMethod,
  type HttpResponse,
  type PluginContext,
} from '@sc/api';

import {
  lockedVault,
  noPassword,
  notCreated,
  refused,
  signedOut,
  statusError,
  tooManyTries,
  transportError,
  unreadable,
  weakKey,
  wrongPassword,
} from './errors';
import { keysFrom, newKdf, newVaultKey, unwrapVault, wrapVault, type AccountKeys } from './keys';
import { decodeSession, encodeSession, type LiveSession, type Session } from './session';
import { kdfToWire, readParams, readSignedIn, type SignedIn } from './wire';

const TIMEOUT_MS = 30_000;
const USERNAME = /^[a-z0-9._-]{1,64}$/;
const MIN_PASSWORD = 10;

export interface RequestOptions {
  readonly body?: string;
  readonly signal?: CancelSignal;
}

export interface ServerClient {
  /** A request with this device's token, signing in first when there is no session. Never answers 401: that ends the session. */
  authorized(method: HttpMethod, path: string, options?: RequestOptions): Promise<HttpResponse>;
  /** This device's session, signing in when there is none. */
  live(signal?: CancelSignal): Promise<LiveSession>;
  /** Checks `password` against the account, as its owner. Throttled, wrong and signed out are errors of their own. */
  verify(password: string, signal?: CancelSignal): Promise<void>;
  /** Creates the account these details name, with an invite, and keeps its session. */
  create(invite: string, signal?: CancelSignal): Promise<void>;
  /** Lets this device's token go at the server, once, and never signs in to do it. */
  signOut(signal?: CancelSignal): Promise<void>;
  json(response: HttpResponse): unknown;
}

/**
 * The server, as one device's account: its session and the rules around it.
 *
 * - With no session — the first call, or after a restore — it signs in once,
 *   shared by every caller.
 * - A refused sign-in is remembered, and never tried again by this client.
 * - A 401 on a call with a token means the server let this device go —
 *   revoked, or its account deleted. It tries a newer token another provider
 *   saved, once; otherwise it leaves a tombstone and never signs itself back
 *   in, which would undo a revoke.
 */
export function createClient(options: { readonly baseUrl: string; readonly username: string; readonly context: PluginContext }): ServerClient {
  const { baseUrl, username, context } = options;
  let session: Session | undefined;
  let loading: Promise<Session | undefined> | undefined;
  let signingIn: Promise<LiveSession> | undefined;
  let refusal: AppError | undefined;

  const send = async (method: HttpMethod, path: string, request: RequestOptions & { readonly token?: string }): Promise<HttpResponse> => {
    try {
      return await context.http.request({
        method,
        url: baseUrl + path,
        headers: {
          Accept: 'application/json',
          ...(request.token ? { Authorization: `Bearer ${request.token}` } : {}),
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

  /** What signing in or creating answered becomes the session — once the password opens the vault key it sent. */
  const opened = async (answer: SignedIn, keys: AccountKeys, kdf: LiveSession['kdf']): Promise<LiveSession> => {
    const vaultKey = await unwrapVault(context.crypto, keys, answer.vault);
    if (!vaultKey) throw lockedVault();
    const next: LiveSession = { kind: 'live', token: answer.token, vaultKey, kdf };
    await keep(next);
    return next;
  };

  const passwordOf = async () => (await context.credentials.read()).password ?? '';

  const signIn = (): Promise<LiveSession> => {
    if (refusal) return Promise.reject(refusal);
    // Shared by every caller, and cancelled by none of them.
    signingIn ??= (async () => {
      // No account can have this name, and no sign-in without a password: neither is worth a request, or a miss.
      if (!USERNAME.test(username)) {
        refusal = refused();
        throw refusal;
      }
      const password = await passwordOf();
      if (password === '') throw noPassword();
      const params = await send('POST', '/v1/auth/params', { body: JSON.stringify({ username }) });
      if (params.status >= 400) throw statusError(params.status);
      const kdf = readParams(json(params));
      if (!kdf) throw unreadable();
      if (!isKdfParams(kdf)) throw weakKey();
      const keys = await keysFrom(context.crypto, password, kdf);
      const response = await send('POST', '/v1/auth/login', {
        body: JSON.stringify({
          username,
          proof: encodeBase64Url(keys.proof),
          installation: context.client.installationId,
          deviceName: context.client.deviceName,
        }),
      });
      if (response.status === 401) {
        refusal = refused();
        throw refusal;
      }
      // Throttled, not refused: nothing judged the password, so nothing is remembered.
      if (response.status >= 400) throw statusError(response.status);
      const answer = readSignedIn(json(response));
      if (!answer) throw unreadable();
      return opened(answer, keys, kdf);
    })().finally(() => {
      signingIn = undefined;
    });
    return signingIn;
  };

  const live = async (signal?: CancelSignal): Promise<LiveSession> => {
    const known = await current();
    if (known?.kind === 'signed-out') throw signedOut();
    return known ?? (await raced(signIn(), signal));
  };

  const authorized = async (method: HttpMethod, path: string, request: RequestOptions = {}): Promise<HttpResponse> => {
    const first = await live(request.signal);
    const response = await send(method, path, { ...request, token: first.token });
    if (response.status !== 401) return response;
    // A sign-in elsewhere on this device may have saved a newer token since: that one is tried, once.
    const latest = await stored();
    if (latest?.kind === 'live' && latest.token !== first.token) {
      session = latest;
      const again = await send(method, path, { ...request, token: latest.token });
      if (again.status !== 401) return again;
    }
    await keep({ kind: 'signed-out' });
    throw signedOut();
  };

  return {
    authorized,
    live,
    json,

    verify: async (password, signal) => {
      // Nothing to judge: no request, so it never counts as a miss.
      if (password === '') throw wrongPassword();
      const { kdf } = await live(signal);
      const keys = await keysFrom(context.crypto, password, kdf, signal);
      const response = await authorized('POST', '/v1/auth/verify', {
        body: JSON.stringify({ proof: encodeBase64Url(keys.proof) }),
        ...(signal ? { signal } : {}),
      });
      if (response.status === 204 || response.status === 200) return;
      if (response.status === 403) throw wrongPassword();
      if (response.status === 429) throw tooManyTries('never');
      throw statusError(response.status);
    },

    create: async (invite, signal) => {
      if (!USERNAME.test(username)) throw notCreated('username');
      const password = await passwordOf();
      if ([...password].length < MIN_PASSWORD) throw notCreated('password');
      const kdf = newKdf(context.crypto);
      const keys = await keysFrom(context.crypto, password, kdf, signal);
      const vaultKey = newVaultKey(context.crypto);
      const response = await send('POST', '/v1/accounts', {
        body: JSON.stringify({
          invite,
          username,
          kdf: kdfToWire(kdf),
          proof: encodeBase64Url(keys.proof),
          vault: await wrapVault(context.crypto, keys, vaultKey),
          installation: context.client.installationId,
          deviceName: context.client.deviceName,
        }),
        ...(signal ? { signal } : {}),
      });
      if (response.status === 403) throw notCreated('invite');
      if (response.status === 409) throw notCreated('taken');
      if (response.status >= 400) throw statusError(response.status);
      const answer = readSignedIn(json(response));
      if (!answer) throw unreadable();
      // Opening what came back proves the server kept the vault key as it was sent.
      await opened(answer, keys, kdf);
    },

    signOut: async (signal) => {
      const known = await current();
      if (known?.kind !== 'live') return;
      try {
        const response = await send('POST', '/v1/auth/logout', { token: known.token, ...(signal ? { signal } : {}) });
        // Already let go is let go.
        if (response.status >= 400 && response.status !== 401) throw statusError(response.status);
      } finally {
        await keep({ kind: 'signed-out' });
      }
    },
  };
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

