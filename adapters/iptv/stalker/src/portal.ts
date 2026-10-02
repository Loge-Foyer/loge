import { AppError, isTransportError, TransportError, type CancelSignal, type HttpResponse, type MediaContext } from '@loge/api';

// A MAG box, as portals expect to see one. Some refuse anything else.
const USER_AGENT = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
const X_USER_AGENT = 'Model: MAG250; Link: WiFi';
const TIMEOUT_MS = 15_000;
// What a portal answers, as text, for a token it no longer takes.
const AUTHORIZATION_FAILED = 'Authorization failed.';
const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

export type QueryValue = string | number | undefined;

interface Session {
  readonly endpoint: string;
  readonly token: string;
}

export interface CallOptions {
  /** For an answer about the whole portal — every channel, every channel's guide — which takes longer than a page. */
  readonly timeoutMs?: number;
}

export interface Portal {
  /** One call — `type` and `action` as the portal names them — signed in first when needed. Answers the `js` part. */
  call(type: string, action: string, params?: Readonly<Record<string, QueryValue>>, signal?: CancelSignal, options?: CallOptions): Promise<unknown>;
  /** Finds the portal behind the address, signs in and reads the profile: Test connection. */
  check(signal?: CancelSignal): Promise<void>;
  /** The portal's root, for a logo it names by path. Known once a call has found it. */
  root(): string | undefined;
}

/**
 * Where a portal's API may be, for the address a provider hands out:
 * `…/c/`, `…/stalker_portal/c/`, or an address that names the script itself.
 */
export function endpointsFor(portalUrl: string): readonly string[] {
  let url = portalUrl.trim();
  if (!/^[a-z]+:\/\//i.test(url)) url = `http://${url}`;
  for (const marker of ['#', '?']) {
    const at = url.indexOf(marker);
    if (at >= 0) url = url.slice(0, at);
  }
  if (/\.php$/i.test(url)) return [url];
  const base = url.replace(/\/+$/, '').replace(/\/c$/i, '').replace(/\/+$/, '');
  const candidates = [`${base}/server/load.php`, `${base}/portal.php`];
  if (!/\/stalker_portal$/i.test(base)) candidates.splice(1, 0, `${base}/stalker_portal/server/load.php`);
  return candidates;
}

/**
 * A Stalker portal session. The MAC address is what signs in: a portal that
 * refuses it is remembered, and never asked again by this session — nor is a
 * handshake repeated more than once for one call.
 *
 * A portal keeps one token per MAC address, so every handshake ends the token
 * before it. Calls that start together therefore share everything: one read
 * of the saved session, one sign-in, and one renewal when the token runs out —
 * a call that finds the token already renewed takes the new one, rather than
 * shaking hands again and ending it for the others.
 */
export function createPortal(options: { readonly portalUrl: string; readonly context: MediaContext }): Portal {
  const { context } = options;
  const candidates = endpointsFor(options.portalUrl);
  let session: Session | undefined;
  let loading: Promise<void> | undefined;
  let signingIn: Promise<Session> | undefined;
  let refused: AppError | undefined;

  const identity = async () => {
    const secrets = await context.credentials.read();
    const mac = (secrets.mac ?? '').trim().toUpperCase().replace(/-/g, ':');
    if (!MAC.test(mac)) throw new AppError('INVALID_STATE', 'The MAC address should look like 00:1A:79:12:34:56.', { retry: 'never' });
    return { mac, serialNumber: secrets.serialNumber, deviceId: secrets.deviceId, signature: secrets.signature };
  };

  const send = async (endpoint: string, params: Readonly<Record<string, QueryValue>>, token: string | undefined, signal?: CancelSignal, timeoutMs = TIMEOUT_MS) => {
    const { mac } = await identity();
    const base = endpoint.replace(/\/(server\/load|portal)\.php$/i, '').replace(/\/stalker_portal$/i, '');
    try {
      return await context.http.request({
        method: 'GET',
        url: endpoint + queryString({ ...params, JsHttpRequest: '1-xml' }),
        headers: {
          'User-Agent': USER_AGENT,
          'X-User-Agent': X_USER_AGENT,
          Referer: `${base}/c/`,
          Cookie: `mac=${mac}; stb_lang=en; timezone=UTC`,
          Accept: '*/*',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        timeoutMs,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (!isTransportError(error)) throw error;
      if (error.kind === 'aborted') throw error;
      if (error.kind === 'offline') throw new AppError('OFFLINE', 'There is no network connection.', { retry: 'network-change', cause: error });
      if (error.kind === 'timeout') throw new AppError('TIMEOUT', 'The portal took too long to answer.', { retry: 'backoff', cause: error });
      throw new AppError('PROVIDER_UNAVAILABLE', 'The portal cannot be reached.', { retry: 'backoff', cause: error });
    }
  };

  const handshake = async (endpoint: string): Promise<string | undefined> => {
    const response = await send(endpoint, { type: 'stb', action: 'handshake', token: '' }, undefined);
    if (response.status !== 200) return undefined;
    const token = text(record(record(parse(response))?.js)?.token);
    return token;
  };

  /** The profile says whether this MAC address may use the portal. Anything but yes is a refusal, remembered. */
  const readProfile = async (candidate: Session) => {
    const { serialNumber, deviceId, signature } = await identity();
    const response = await send(
      candidate.endpoint,
      {
        type: 'stb',
        action: 'get_profile',
        hd: 1,
        ver: 'ImageDescription: 0.2.18-r23-250; ImageDate: Wed Aug 29 10:49:53 EEST 2018; PORTAL version: 5.6.2; API Version: JS API version: 343; STB API version: 146; Player Engine version: 0x58c',
        num_banks: 2,
        sn: serialNumber ?? '',
        stb_type: 'MAG250',
        image_version: 218,
        video_out: 'hdmi',
        device_id: deviceId ?? '',
        device_id2: deviceId ?? '',
        signature: signature ?? '',
        auth_second_step: 1,
        hw_version: '1.7-BD-00',
        not_valid_token: 0,
        api_signature: 262,
      },
      candidate.token,
    );
    const profile = record(record(response.status === 200 ? parse(response) : undefined)?.js);
    if (response.status === 401 || response.status === 403 || response.text.trim() === AUTHORIZATION_FAILED) throw refusal();
    if (response.status >= 400) throw statusError(response.status);
    const status = Number(profile?.status ?? 0);
    const blocked = String(profile?.blocked ?? '0') === '1';
    if (blocked) throw refusal('This subscription is blocked.');
    if (status !== 0) throw refusal();
  };

  const refusal = (message = 'The portal did not accept this MAC address.') => {
    refused = new AppError('UNAUTHORIZED', message, { retry: 'never' });
    return refused;
  };

  /**
   * The session an earlier run saved, read once however many calls start
   * together: a second read racing the first would see no session, shake hands,
   * and end the saved token the first was using.
   */
  const stored = async (): Promise<Session | undefined> => {
    loading ??= (async () => {
      try {
        const saved = record(JSON.parse((await context.session.read()) ?? 'null'));
        const endpoint = text(saved?.endpoint);
        const token = text(saved?.token);
        // A sign-in that finished meanwhile is newer than anything saved.
        if (!session && endpoint && token && candidates.includes(endpoint)) session = { endpoint, token };
      } catch {
        // Not this plugin's: sign in again.
      }
    })();
    await loading;
    return session;
  };

  /**
   * One sign-in at a time, shared by every caller: the endpoint this address
   * answers on — tried in order, once — a token, and the profile. It runs on
   * no caller's signal, so one caller giving up fails nobody else; each stops
   * waiting on its own.
   */
  const signIn = (signal?: CancelSignal): Promise<Session> => {
    if (refused) return Promise.reject(refused);
    signingIn ??= (async () => {
      const known = session?.endpoint;
      for (const endpoint of known ? [known] : candidates) {
        const token = await handshake(endpoint);
        if (!token) continue;
        const next = { endpoint, token };
        await readProfile(next);
        session = next;
        await context.session.write(JSON.stringify(next));
        return next;
      }
      throw new AppError('NOT_FOUND', 'No Stalker portal answers at this address.', { retry: 'never' });
    })().finally(() => {
      signingIn = undefined;
    });
    return abandonable(signingIn, signal);
  };

  const expired = (response: HttpResponse) => response.status === 401 || response.text.trim() === AUTHORIZATION_FAILED;

  const call: Portal['call'] = async (type, action, params = {}, signal, options = {}) => {
    if (refused) throw refused;
    const first = (await stored()) ?? (await signIn(signal));
    let response = await send(first.endpoint, { type, action, ...params }, first.token, signal, options.timeoutMs);
    if (expired(response)) {
      // The token ran out: one more handshake for this call, and no more —
      // and none at all when another call has renewed it meanwhile.
      const renewed = session && session.token !== first.token ? session : await signIn(signal);
      response = await send(renewed.endpoint, { type, action, ...params }, renewed.token, signal, options.timeoutMs);
      if (expired(response)) {
        // A token the portal handed out a moment ago, refused at once: the
        // session was ended from elsewhere — the same MAC address signing in
        // on another device — rather than this device refused. So it is not
        // latched, and nothing loops: this call fails, and the next sign-in
        // waits for the next call.
        if (session === renewed) {
          session = undefined;
          await context.session.clear();
        }
        throw new AppError('PROVIDER_UNAVAILABLE', 'The portal ended this device’s session. If this MAC address is in use somewhere else, close it there.', {
          retry: 'never',
        });
      }
    }
    if (response.status >= 400) throw statusError(response.status);
    const body = record(parse(response));
    if (!body || !('js' in body)) throw unreadable();
    return body.js;
  };

  return {
    call,
    check: async (signal) => {
      await identity();
      await signIn(signal);
    },
    root: () => {
      const endpoint = session?.endpoint ?? candidates[0];
      return endpoint?.replace(/\/(server\/load|portal)\.php$/i, '').replace(/\/stalker_portal$/i, '');
    },
  };
}

function parse(response: HttpResponse): unknown {
  try {
    return JSON.parse(response.text);
  } catch {
    return undefined;
  }
}

// Errors that are the portal's answer — it was reached, and said no, or said
// something that is no answer at all — as against failing to reach it.
const answers = new WeakSet<AppError>();
const answer = (error: AppError) => {
  answers.add(error);
  return error;
};

/** Whether an error is what the portal answered, rather than a failure to ask it: the portal was reached. */
export function isPortalAnswer(error: unknown): boolean {
  return error instanceof AppError && answers.has(error);
}

function statusError(status: number): AppError {
  if (status === 404) return answer(new AppError('NOT_FOUND', 'The portal has no such thing.'));
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'The portal ran into a problem.', { retry: 'backoff' });
  return answer(new AppError('PROVIDER_UNAVAILABLE', `The portal refused the request (${status}).`, { retry: 'never' }));
}

export function unreadable(): AppError {
  return answer(new AppError('PROVIDER_UNAVAILABLE', 'The portal sent an answer that could not be read.', { retry: 'backoff' }));
}

/**
 * Work several callers share, waited on by one of them: when its signal
 * aborts, that caller stops waiting, and the work goes on for the others.
 */
export function abandonable<T>(work: Promise<T>, signal: CancelSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new TransportError('aborted'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new TransportError('aborted'));
    signal.addEventListener('abort', abort);
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

export function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function queryString(params: Readonly<Record<string, QueryValue>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
