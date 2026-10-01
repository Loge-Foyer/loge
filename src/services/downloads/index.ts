import { AppError, type DownloadOption, type GlobalMediaKey, type MediaItem, type PlaybackDescriptor, type UserId } from '@sc/api';

import type { Clock, DownloadEntry, DownloadRepository, FileStore, IdGenerator, Logger } from '../ports';
import type { SourceService } from '../sources';
import type { ProviderPool } from '../media/pool';
import { isAborted, toAppError } from '../media/errors';

export interface DownloadBudget {
  /** What everything kept weighs, read from the disk rather than the rows. */
  readonly usedBytes: number;
  /** The ceiling this device was given. */
  readonly limitBytes: number;
  /** What the device itself has left, which is the second ceiling. */
  readonly freeBytes: number;
  /** Past this, a new download is refused rather than started and abandoned. */
  readonly full: boolean;
  /** Within sight of the ceiling: worth saying before it is reached. */
  readonly nearlyFull: boolean;
}

export interface DownloadService {
  /** Every version this source will hand over, with what each weighs. */
  options(userId: UserId, key: GlobalMediaKey, signal?: AbortSignal): Promise<readonly DownloadOption[]>;
  /** Queues one. Refused — before anything is fetched — when there is no room. */
  start(userId: UserId, item: MediaItem, optionId?: string): Promise<DownloadEntry>;
  list(userId: UserId): Promise<readonly DownloadEntry[]>;
  /** The copy of this item kept for this profile, if there is one. */
  forItem(userId: UserId, key: GlobalMediaKey): Promise<DownloadEntry | undefined>;
  budget(): Promise<DownloadBudget>;
  remove(id: string): Promise<void>;
  /** Pauses a running one, or restarts a failed one. */
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /**
   * A finished copy as something to play — a `file://` source, which every
   * engine opens and which needs no network at all. Only when it is finished:
   * a half-written file is not something to hand a player.
   */
  ready(userId: UserId, key: GlobalMediaKey): Promise<PlaybackDescriptor | undefined>;
}

/** Warn here rather than at the ceiling: there is still time to delete something. */
const NEARLY = 0.9;
/** Below this the device itself is the problem, whatever the user's ceiling says. */
const KEEP_FREE_BYTES = 512 * 1024 * 1024;

export function createDownloadService(deps: {
  readonly downloads: DownloadRepository;
  readonly files: FileStore;
  readonly sources: SourceService;
  readonly pool: ProviderPool;
  readonly limitBytes: () => Promise<number>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly log: Logger;
  readonly onQueued: () => void;
}): DownloadService {
  const { downloads, files, pool, ids, clock, log } = deps;

  const providerFor = async (userId: UserId, connectionId: GlobalMediaKey['connectionId']) => {
    const source = (await deps.sources.forUser(userId)).find((candidate) => candidate.connection.id === connectionId);
    if (!source) throw new AppError('NOT_FOUND', 'That source is no longer set up.', { retry: 'never' });
    return { source, provider: await pool.provider(source) };
  };

  const budget = async (): Promise<DownloadBudget> => {
    // A device with nowhere to keep anything — a browser, a TV — has no room at all, whatever the setting says.
    const [usedBytes, freeBytes, limitBytes] = await Promise.all([files.used(), files.free(), files.available ? deps.limitBytes() : 0]);
    return {
      usedBytes,
      limitBytes,
      freeBytes,
      full: usedBytes >= limitBytes || freeBytes <= KEEP_FREE_BYTES,
      nearlyFull: usedBytes >= limitBytes * NEARLY,
    };
  };

  return {
    budget,

    options: async (userId, key, signal) => {
      const { source, provider } = await providerFor(userId, key.connectionId);
      if (!(source.effective.media?.capabilities.has('downloadOptions') ?? false)) return [];
      if (!provider.listDownloadOptions) return [];
      try {
        return await provider.listDownloadOptions(key, signal === undefined ? undefined : toCancel(signal));
      } catch (error) {
        if (isAborted(error)) throw error;
        throw toAppError(error, log);
      }
    },

    start: async (userId, item, optionId) => {
      if (!files.available) {
        throw new AppError('INVALID_STATE', 'This device cannot keep downloads.', { retry: 'never' });
      }
      const existing = await downloads.forItem(userId, item.key);
      if (existing) return existing;
      const room = await budget();
      if (room.full) {
        throw new AppError('STORAGE_FAILURE', 'There is no room left for downloads.', { retry: 'never' });
      }
      const { source } = await providerFor(userId, item.key.connectionId);
      if (!(source.effective.media?.capabilities.has('downloads') ?? false)) {
        throw new AppError('INVALID_STATE', 'That source cannot hand over a copy.', { retry: 'never' });
      }
      const id = ids.next();
      const entry: DownloadEntry = {
        id,
        userId,
        key: item.key,
        state: 'queued',
        ...(optionId === undefined ? {} : { optionId }),
        item,
        // The id, not the title: a title holds slashes, colons and emoji, and
        // this is a path. The container is settled when the descriptor arrives.
        fileName: `${id}.download`,
        container: '',
        bytesDone: 0,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      };
      await downloads.put(entry);
      deps.onQueued();
      return entry;
    },

    list: (userId) => downloads.list(userId),
    forItem: (userId, key) => downloads.forItem(userId, key),

    ready: async (userId, key) => {
      if (!files.available) return undefined;
      const entry = await downloads.forItem(userId, key);
      if (!entry || entry.state !== 'done') return undefined;
      return {
        key,
        sources: [
          {
            uri: files.uriOf(entry.fileName),
            // One file on disk: nothing to negotiate, nothing to fetch.
            protocol: 'progressive',
            container: entry.container,
            transcoded: false,
            live: false,
          },
        ],
        audioTracks: [],
        subtitleTracks: [],
        ...(entry.item.runtimeMs === undefined ? {} : { durationMs: entry.item.runtimeMs }),
        ...(entry.item.watch?.played === false && entry.item.watch.positionMs !== undefined
          ? { startMs: entry.item.watch.positionMs }
          : {}),
      };
    },

    remove: async (id) => {
      const entry = await downloads.get(id);
      if (!entry) return;
      await downloads.remove(id);
      // The row goes first: a file nothing points at is swept, while a row
      // pointing at a file that is gone would show a download that cannot play.
      await files.remove(entry.fileName);
    },

    pause: async (id) => {
      const entry = await downloads.get(id);
      if (!entry || (entry.state !== 'running' && entry.state !== 'queued')) return;
      await downloads.put({ ...entry, state: 'paused', updatedAt: clock.now() });
      deps.onQueued();
    },

    resume: async (id) => {
      const entry = await downloads.get(id);
      if (!entry || entry.state === 'done' || entry.state === 'running') return;
      const next: DownloadEntry = { ...entry, state: 'queued', updatedAt: clock.now() };
      const { errorCode: _dropped, ...withoutError } = next;
      await downloads.put(withoutError as DownloadEntry);
      deps.onQueued();
    },
  };
}

/** The app's `AbortSignal` as the contract's `CancelSignal`. */
function toCancel(signal: AbortSignal) {
  return {
    get aborted() {
      return signal.aborted;
    },
    addEventListener: (type: 'abort', listener: () => void) => signal.addEventListener(type, listener),
    removeEventListener: (type: 'abort', listener: () => void) => signal.removeEventListener(type, listener),
  };
}
