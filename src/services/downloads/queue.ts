import { AppError, type DownloadDescriptor } from '@sc/api';

import { isAborted, toAppError } from '../media/errors';
import type { ProviderPool } from '../media/pool';
import type { AppActivity, Clock, DownloadEntry, DownloadRepository, FileStore, Logger, NetworkMonitor } from '../ports';
import type { Source, SourceService } from '../sources';

const AFTER_QUEUE_MS = 500;
const FIRST_RETRY_MS = 30_000;
const LAST_RETRY_MS = 30 * 60_000;
/** The row is written this often while bytes arrive, not on every callback. */
const PROGRESS_EVERY_MS = 1_000;

export interface DownloadQueue {
  start(): void;
  stop(): void;
  /** Something was queued, or the network came back: look again soon. */
  kick(): void;
  /** Fetches what can be fetched now, and resolves when that is done. */
  drain(): Promise<void>;
}

/**
 * Fetches what is queued, one at a time. One at a time on purpose: two films
 * over one link finish no sooner together than one after the other, and the
 * one the user is waiting for finishes later.
 *
 * It follows the same rules as the watch outbox — `backoff` tries again,
 * doubling; `network-change` and a refused sign-in park the source until the
 * user or the network acts — because a server that locks accounts does not
 * care which of the two is knocking.
 *
 * **The address is asked for each time.** It can carry an `api_key`, an HMAC
 * signature or a session token, so it is never a row: a resume is a fresh
 * descriptor and a `Range` from what is already on disk.
 */
export function createDownloadQueue(deps: {
  readonly downloads: DownloadRepository;
  readonly files: FileStore;
  readonly sources: SourceService;
  readonly pool: ProviderPool;
  readonly network: NetworkMonitor;
  readonly activity: AppActivity;
  readonly clock: Clock;
  readonly log: Logger;
  readonly onlyOnWifi: () => Promise<boolean>;
  readonly afterQueueMs?: number;
}): DownloadQueue {
  const { downloads, files, pool, clock, log } = deps;
  let running: Promise<void> | undefined;
  let again = false;
  let soon: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void)[] = [];
  let current: AbortController | undefined;
  const attempts = new Map<string, number>();
  const notBefore = new Map<string, number>();

  const sourceOf = async (entry: DownloadEntry): Promise<Source | undefined> =>
    (await deps.sources.forUser(entry.userId)).find((candidate) => candidate.connection.id === entry.key.connectionId);

  const describe = async (entry: DownloadEntry, source: Source, signal: AbortSignal): Promise<DownloadDescriptor> => {
    const provider = await pool.provider(source);
    if (!provider.getDownloadDescriptor) throw new AppError('INVALID_STATE', 'That source cannot hand over a copy.', { retry: 'never' });
    return provider.getDownloadDescriptor(
      { key: entry.key, ...(entry.optionId === undefined ? {} : { optionId: entry.optionId }) },
      {
        get aborted() {
          return signal.aborted;
        },
        addEventListener: (type: 'abort', listener: () => void) => signal.addEventListener(type, listener),
        removeEventListener: (type: 'abort', listener: () => void) => signal.removeEventListener(type, listener),
      },
    );
  };

  const fetchOne = async (entry: DownloadEntry): Promise<void> => {
    const source = await sourceOf(entry);
    if (!source || pool.parked(source)) return;

    const controller = new AbortController();
    current = controller;
    try {
      const descriptor = await describe(entry, source, controller.signal);
      const headers = descriptor.headersRef ? await resolveHeaders(source, descriptor) : undefined;
      // The extension is known only now, so the name settles with the first
      // successful descriptor and is kept for every resume after it.
      const fileName = entry.container === '' ? `${entry.id}.${descriptor.container}` : entry.fileName;
      const started: DownloadEntry = {
        ...entry,
        state: 'running',
        fileName,
        container: descriptor.container,
        ...(descriptor.expectedBytes === undefined ? {} : { bytesTotal: descriptor.expectedBytes }),
        updatedAt: clock.now(),
      };
      await downloads.put(started);

      let lastWrite = 0;
      const done = await files.fetch({
        uri: descriptor.uri,
        ...(headers ? { headers } : {}),
        fileName,
        signal: controller.signal,
        onProgress: (progress) => {
          const now = clock.now();
          if (now - lastWrite < PROGRESS_EVERY_MS) return;
          lastWrite = now;
          void downloads
            .put({
              ...started,
              bytesDone: progress.bytesDone,
              ...(progress.bytesTotal === undefined ? {} : { bytesTotal: progress.bytesTotal }),
              updatedAt: now,
            })
            .catch(() => undefined);
        },
      });

      await downloads.put({
        ...started,
        state: 'done',
        bytesDone: done.bytesDone,
        ...(done.bytesTotal === undefined ? {} : { bytesTotal: done.bytesTotal }),
        updatedAt: clock.now(),
      });
      attempts.delete(entry.id);
      notBefore.delete(entry.id);
    } catch (error) {
      if (isAborted(error) || controller.signal.aborted) {
        // Paused, or the app is going away: the bytes on disk stay, and the
        // next pass resumes from them.
        return;
      }
      await failed(entry, source, toAppError(error, log));
    } finally {
      current = undefined;
    }
  };

  const resolveHeaders = async (source: Source, descriptor: DownloadDescriptor) => {
    const provider = await pool.provider(source);
    return descriptor.headersRef && provider.resolveHeaders ? provider.resolveHeaders(descriptor.headersRef) : undefined;
  };

  const failed = async (entry: DownloadEntry, source: Source, failure: AppError): Promise<void> => {
    if (failure.code === 'UNAUTHORIZED' || failure.retry === 'network-change') {
      pool.park(source, failure);
      // Still queued: it waits for the source rather than counting as failed.
      return;
    }
    if (failure.retry === 'never') {
      log.warn('provider', 'A download was refused for good', { code: failure.code });
      await downloads.put({ ...entry, state: 'failed', errorCode: failure.code, updatedAt: clock.now() });
      return;
    }
    const tried = (attempts.get(entry.id) ?? 0) + 1;
    attempts.set(entry.id, tried);
    notBefore.set(entry.id, clock.now() + Math.min(FIRST_RETRY_MS * 2 ** (tried - 1), LAST_RETRY_MS));
  };

  const pass = async () => {
    const network = deps.network.current();
    if (network === 'none') return;
    if ((await deps.onlyOnWifi()) && network === 'cellular') return;

    const all = await downloads.listAll();
    // What the queue left behind: a file nothing points at any more.
    await files.sweep(new Set(all.map((entry) => entry.fileName))).catch(() => undefined);

    let nextRetry: number | undefined;
    for (const entry of [...all].sort((a, b) => a.createdAt - b.createdAt)) {
      if (entry.state === 'done' || entry.state === 'paused' || entry.state === 'failed') continue;
      const waitUntil = notBefore.get(entry.id);
      if (waitUntil !== undefined && waitUntil > clock.now()) {
        nextRetry = Math.min(nextRetry ?? waitUntil, waitUntil);
        continue;
      }
      await fetchOne(entry);
      // One at a time: the next pass picks up whatever is next.
      break;
    }

    clearTimeout(retry);
    if (nextRetry !== undefined) retry = setTimeout(later, Math.max(0, nextRetry - clock.now()));
  };

  const drain = async (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } catch (error) {
        log.error('provider', 'The download queue could not run', { error: String(error) });
      } finally {
        running = undefined;
      }
    })();
    return running;
  };

  const later = () => void drain();

  return {
    start: () => {
      if (unsubscribe.length > 0) return;
      unsubscribe = [
        deps.network.subscribe((kind) => {
          if (kind !== 'none') void drain();
        }),
        deps.activity.subscribe((active) => {
          if (active) void drain();
        }),
      ];
      void drain();
    },
    stop: () => {
      for (const off of unsubscribe) off();
      unsubscribe = [];
      clearTimeout(soon);
      clearTimeout(retry);
      current?.abort();
    },
    kick: () => {
      // A pause has to reach the fetch in flight, not only the next pass.
      current?.abort();
      clearTimeout(soon);
      soon = setTimeout(later, deps.afterQueueMs ?? AFTER_QUEUE_MS);
    },
    drain,
  };
}
