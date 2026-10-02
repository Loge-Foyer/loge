import { TransportError, type HttpClient, type HttpResponse } from '@sc/api';

import type { Logger, NetworkMonitor } from '@/services/ports';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;

/** The part of `fetch` this client uses, so a test can supply its own. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; credentials: 'omit' },
) => Promise<{ status: number; headers: { forEach(callback: (value: string, key: string) => void): void }; text(): Promise<string> }>;

/**
 * The HTTP client every plugin gets. It answers every status, fails only with
 * a `TransportError`, gives up after the request's timeout — reading the body
 * included — and never logs a query string, a header or a body.
 *
 * It keeps no cookies, and sends none but a plugin's own. The platform's jar
 * would otherwise join in: on iOS a stored cookie is comma-appended to the
 * plugin's `Cookie` header, and on Android the jar replaces it — so a portal
 * that sets any cookie stopped reading the `mac=` it signs in with, until that
 * cookie expired. Every plugin says who it is in its own headers.
 */
export function createHttpClient(deps: { fetch: FetchLike; network: NetworkMonitor; log: Logger; now: () => number }): HttpClient {
  // Called unbound: a browser's fetch refuses to run with anything else as `this`.
  const { fetch } = deps;
  return {
    request: async (request) => {
      if (deps.network.current() === 'none') throw new TransportError('offline');
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
      );
      // Forwarded by hand: not every engine has AbortSignal.any.
      const forward = () => controller.abort();
      request.signal?.addEventListener('abort', forward);
      const started = deps.now();
      try {
        if (request.signal?.aborted) throw new TransportError('aborted');
        const response = await fetch(request.url, {
          method: request.method,
          headers: { ...request.headers },
          ...(request.body === undefined ? {} : { body: request.body }),
          signal: controller.signal,
          credentials: 'omit',
        });
        const text = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        deps.log.debug('provider', `${request.method} ${withoutQuery(request.url)} ${response.status} ${deps.now() - started}ms`);
        const result: HttpResponse = { status: response.status, headers, text };
        return result;
      } catch (error) {
        if (error instanceof TransportError) throw error;
        if (request.signal?.aborted) throw new TransportError('aborted');
        if (timedOut) throw new TransportError('timeout');
        deps.log.debug('provider', `${request.method} ${withoutQuery(request.url)} failed`, { error: String(error) });
        throw new TransportError('unreachable');
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', forward);
      }
    },
  };
}

function withoutQuery(url: string): string {
  const at = url.indexOf('?');
  return at < 0 ? url : url.slice(0, at);
}
