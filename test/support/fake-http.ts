import {
  connectionId,
  TransportError,
  type Credentials,
  type HttpClient,
  type HttpMethod,
  type HttpRequest,
  type MediaContext,
  type MediaTarget,
  type NetworkKind,
} from '@sc/api';

import { nodeCrypto } from './node-crypto';

export interface RecordedRequest {
  readonly method: HttpMethod;
  /** The path after the server's origin, base path included. */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

export type Reply =
  | {
      readonly status: number;
      readonly json?: unknown;
      readonly text?: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | TransportError;

export type Route = Reply | ((request: RecordedRequest, calls: number) => Reply | Promise<Reply>);

/**
 * An HTTP client answering from a table of `"METHOD /path"` routes, recording
 * every request. Unknown routes answer 404, as a server would.
 */
export function fakeHttp(routes: Readonly<Record<string, Route>>) {
  const requests: RecordedRequest[] = [];
  const calls = new Map<string, number>();
  const client: HttpClient = {
    request: async (request) => {
      const recorded = record(request);
      requests.push(recorded);
      const name = `${recorded.method} ${recorded.path}`;
      const count = (calls.get(name) ?? 0) + 1;
      calls.set(name, count);
      const route = routes[name];
      const reply = route === undefined ? { status: 404 } : typeof route === 'function' ? await route(recorded, count) : route;
      if (reply instanceof TransportError) throw reply;
      return { status: reply.status, headers: reply.headers ?? {}, text: reply.text ?? JSON.stringify(reply.json ?? {}) };
    },
  };
  return {
    client,
    requests,
    /** Requests to one route, in order. */
    to: (name: string) => requests.filter((request) => `${request.method} ${request.path}` === name),
  };
}

function record(request: HttpRequest): RecordedRequest {
  const withoutOrigin = request.url.replace(/^[a-z]+:\/\/[^/]+/i, '');
  const [path = '', search = ''] = withoutOrigin.split('?');
  const query: Record<string, string> = {};
  for (const pair of search.split('&')) {
    if (pair === '') continue;
    const [key = '', value = ''] = pair.split('=');
    query[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return {
    method: request.method,
    path,
    query,
    headers: request.headers ?? {},
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
  };
}

export interface FakeContextOptions {
  readonly http: HttpClient;
  readonly credentials?: Credentials;
  readonly network?: NetworkKind;
  readonly session?: string;
  readonly installationId?: string;
}

/** A context whose session, network and clock the test can look at and change. */
export function fakeContext(options: FakeContextOptions) {
  let session = options.session;
  let network: NetworkKind = options.network ?? 'wifi';
  let now = 1_000_000;
  const sleeps: number[] = [];
  const context: MediaContext = {
    http: options.http,
    credentials: { read: async () => options.credentials ?? { password: 'secret' } },
    session: {
      read: async () => session,
      write: async (value) => {
        session = value;
      },
      clear: async () => {
        session = undefined;
      },
    },
    network: { current: () => network },
    client: {
      appName: 'Streaming Center',
      appVersion: '1.0.0',
      deviceName: 'Test Phone',
      installationId: options.installationId ?? 'install-1',
    },
    clock: {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    },
    crypto: nodeCrypto(),
  };
  return {
    context,
    session: () => session,
    setSession: (value: string | undefined) => {
      session = value;
    },
    setNetwork: (kind: NetworkKind) => {
      network = kind;
    },
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
  };
}

export function target(
  fields: MediaTarget['fields'],
  settings: MediaTarget['settings'] = {},
  id = 'connection-1',
): MediaTarget {
  return { connectionId: connectionId(id), fields, settings };
}
