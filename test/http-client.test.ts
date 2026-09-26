import { isTransportError } from '@sc/api';
import { describe, expect, it } from 'vitest';

import type { Logger } from '@/services/ports';
import { createHttpClient, type FetchLike } from '@/platform/http-client';

import { fakeNetwork } from './support/services';

function recordingLog() {
  const lines: string[] = [];
  const log: Logger = {
    debug: (_category, message, fields) => lines.push(message + (fields ? JSON.stringify(fields) : '')),
    warn: (_category, message) => lines.push(message),
    error: (_category, message) => lines.push(message),
  };
  return { log, lines };
}

const answer = (status: number, text = '{}'): ReturnType<FetchLike> =>
  Promise.resolve({ status, headers: { forEach: (callback) => callback('application/json', 'Content-Type') }, text: async () => text });

async function failure(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  if (!isTransportError(error)) throw new Error(`expected a transport error, got ${String(error)}`);
  return error.kind;
}

describe('the HTTP client plugins get', () => {
  it('answers every status, with lower-cased headers', async () => {
    const client = createHttpClient({ fetch: () => answer(503, 'down'), network: fakeNetwork(), log: recordingLog().log, now: () => 0 });
    await expect(client.request({ method: 'GET', url: 'http://home/x' })).resolves.toEqual({
      status: 503,
      headers: { 'content-type': 'application/json' },
      text: 'down',
    });
  });

  it('calls fetch unbound, as a browser requires', async () => {
    const strictFetch: FetchLike = function (this: unknown) {
      // A browser throws "Illegal invocation" when fetch runs with another `this`.
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return answer(200);
    };
    const client = createHttpClient({ fetch: strictFetch, network: fakeNetwork(), log: recordingLog().log, now: () => 0 });
    await expect(client.request({ method: 'GET', url: 'http://home/x' })).resolves.toMatchObject({ status: 200 });
  });

  it('fails fast with no network', async () => {
    let called = false;
    const client = createHttpClient({
      fetch: () => {
        called = true;
        return answer(200);
      },
      network: fakeNetwork('none'),
      log: recordingLog().log,
      now: () => 0,
    });
    expect(await failure(client.request({ method: 'GET', url: 'http://home/x' }))).toBe('offline');
    expect(called).toBe(false);
  });

  it('turns a hung request into a timeout, and a refused one into unreachable', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const slow = createHttpClient({ fetch: hang, network: fakeNetwork(), log: recordingLog().log, now: () => 0 });
    expect(await failure(slow.request({ method: 'GET', url: 'http://home/x', timeoutMs: 5 }))).toBe('timeout');

    const refused = createHttpClient({ fetch: () => Promise.reject(new TypeError('Network request failed')), network: fakeNetwork(), log: recordingLog().log, now: () => 0 });
    expect(await failure(refused.request({ method: 'GET', url: 'http://home/x' }))).toBe('unreachable');
  });

  it('reports a caller’s cancellation as aborted', async () => {
    const controller = new AbortController();
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const client = createHttpClient({ fetch: hang, network: fakeNetwork(), log: recordingLog().log, now: () => 0 });
    const pending = client.request({ method: 'GET', url: 'http://home/x', signal: controller.signal });
    controller.abort();
    expect(await failure(pending)).toBe('aborted');
  });

  it('never logs a query string, a header or a body', async () => {
    const { log, lines } = recordingLog();
    const client = createHttpClient({ fetch: () => answer(200, 'secret body'), network: fakeNetwork(), log, now: () => 0 });
    await client.request({
      method: 'POST',
      url: 'http://home/Users/AuthenticateByName?api_key=abc',
      headers: { Authorization: 'MediaBrowser Token="t"' },
      body: '{"Pw":"hunter2"}',
    });
    const logged = lines.join('\n');
    expect(logged).toContain('POST http://home/Users/AuthenticateByName 200');
    for (const secret of ['api_key', 'abc', 'Token', 'hunter2', 'secret body']) expect(logged).not.toContain(secret);
  });
});
