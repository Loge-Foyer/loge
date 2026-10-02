import {
  AppError,
  bareTitle,
  connectionId as toConnectionId,
  resolveValues,
  showIdentityOf,
  watchIdentity,
  type CancelSignal,
  type ConnectedMetadataProvider,
  type Connection,
  type ConnectionValues,
  type ExternalIds,
  type GlobalMediaKey,
  type IdentifyQuery,
  type MediaItem,
  type PluginManifest,
  type SourceInfo,
  type UserId,
} from '@loge/api';

import type { ConnectionService } from './connections';
import { stableJson } from './hash';
import { isAborted, toAppError } from './media/errors';
import type { ProbeTarget } from './media';
import { pluginContext, secretsOf, type PluginContextDeps } from './plugin-context';
import type { PluginCatalog } from './plugin-catalog';
import type { Clock, ConnectionRepository, LocalDatabase, Logger, SecureCredentialStore } from './ports';
import type { Sessions } from './sessions';
import { standingOf, type SourceService } from './sources';
import { itemKeyOf } from './watch/item-key';
import { moveKept, type KeptMove } from './watch/kept';

// A title nothing matched is asked about again after this long: a catalogue grows.
const MISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
// TMDB counts around fifty requests a second from one address; an identity is one to three.
const AT_ONCE = 4;
// After a refusal for load, a timeout or no network: lookups wait this long.
const PAUSE_MS = 60_000;

/**
 * What a title is, for watch status the app keeps.
 *
 * An IPTV provider keeps a copy of a film for each language, each its own
 * item under its own name, and often says nothing more of it. Watch status is
 * keyed by what a thing is (`watchIdentity`): a catalogue id where the item
 * has one, else its title — and two languages' titles differ. A metadata
 * connection (TMDB) answers with the catalogue's id; this device remembers the
 * answer, lays it onto the item before it is keyed, and moves whatever was
 * kept under the title to it. Only for providers whose watch status the app
 * keeps, only for items with no catalogue id of their own, and only while a
 * metadata connection is on.
 */
export interface IdentityService {
  /** The items, with the catalogue ids this device knows them by laid on. Asks nothing. */
  withKnownIds<T extends MediaItem>(userId: UserId, items: readonly T[]): Promise<readonly T[]>;
  /**
   * Asks the metadata connection about these items — those it has not been
   * asked about lately — four at a time, and moves what was kept under their
   * titles. Whether anything changed: a screen showing their watch status
   * reads it again. Never throws.
   */
  resolve(userId: UserId, items: readonly MediaItem[]): Promise<boolean>;
  /** Test connection, for a metadata connection's form. */
  test(target: ProbeTarget, signal?: CancelSignal): Promise<SourceInfo>;
}

/** One title to ask about: where its answer is kept, and what was kept under the title meanwhile. */
interface Ask {
  readonly key: GlobalMediaKey;
  readonly query: IdentifyQuery;
  /** The title identity it is kept under until it is known. */
  readonly from: string;
  /** The identity it has once it carries `ids`. */
  readonly to: (ids: ExternalIds) => string;
}

interface Metadata {
  readonly connection: Connection;
  readonly manifest: PluginManifest;
  readonly values: ConnectionValues;
  readonly scope: string;
  readonly fingerprint: string;
}

export function createIdentityService(
  deps: PluginContextDeps & {
    readonly db: LocalDatabase;
    readonly connections: ConnectionRepository;
    readonly catalog: PluginCatalog;
    readonly sources: SourceService;
    readonly credentials: SecureCredentialStore;
    readonly sessions: Sessions;
    readonly probeSecrets: ConnectionService['probeSecrets'];
    readonly clock: Clock;
    readonly log: Logger;
  },
): IdentityService {
  const { db, catalog, sources, clock, log } = deps;
  const providers = new Map<string, { readonly fingerprint: string; readonly ready: Promise<ConnectedMetadataProvider> }>();
  // A refused key, by the values it was refused with: a new key is a new fingerprint.
  const refused = new Set<string>();
  const inflight = new Map<string, Promise<KeptMove | undefined>>();
  const waiting: (() => void)[] = [];
  let running = 0;
  let pausedUntil = 0;

  /** The metadata connection this profile uses: the first one on, and set up for it. */
  const metadataFor = async (userId: UserId): Promise<Metadata | undefined> => {
    const manifests = catalog.inCategory('metadata').filter((manifest) => manifest.metadata && catalog.metadataRole(manifest.id));
    if (manifests.length === 0) return undefined;
    const [all, own] = await Promise.all([deps.connections.list(), deps.connections.valuesOfProfile(userId)]);
    for (const connection of all) {
      const manifest = manifests.find((candidate) => candidate.id === connection.pluginId);
      if (!manifest || !connection.enabled) continue;
      const profile = own.get(connection.id);
      if (standingOf(manifest, connection, profile) !== 'live') continue;
      const values = resolveValues(manifest, connection, profile);
      const scope = connection.perProfile === 'none' ? 'shared' : userId;
      const fingerprint = stableJson([connection.id, scope, values.fields, values.settings, values.credentialsRef ?? null]);
      return { connection, manifest, values, scope, fingerprint };
    }
    return undefined;
  };

  const providerOf = (metadata: Metadata): Promise<ConnectedMetadataProvider> => {
    const name = `${metadata.connection.id}|${metadata.scope}`;
    const current = providers.get(name);
    if (current?.fingerprint === metadata.fingerprint) return current.ready;
    current?.ready.then((provider) => provider.dispose()).catch(() => undefined);
    const role = catalog.metadataRole(metadata.manifest.id);
    if (!role) return Promise.reject(new AppError('INVALID_STATE', `${metadata.manifest.displayName} cannot look anything up yet.`, { retry: 'never' }));
    const ready = (async () =>
      role.connect(
        { connectionId: metadata.connection.id, fields: metadata.values.fields, settings: metadata.values.settings },
        await pluginContext(deps, name, secretsOf(deps.credentials, metadata.values), deps.sessions.ephemeral()),
      ))();
    providers.set(name, { fingerprint: metadata.fingerprint, ready });
    ready.catch(() => {
      if (providers.get(name)?.ready === ready) providers.delete(name);
    });
    return ready;
  };

  const slot = async () => {
    if (running < AT_ONCE) {
      running += 1;
      return;
    }
    await new Promise<void>((resume) => waiting.push(resume));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  const failed = (metadata: Metadata, error: unknown) => {
    if (isAborted(error)) return;
    const failure = toAppError(error, log);
    // A refused key is never tried again by itself; the user changes it.
    if (failure.code === 'UNAUTHORIZED') refused.add(metadata.fingerprint);
    else if (failure.retry !== 'never') pausedUntil = clock.now() + PAUSE_MS;
    log.debug('provider', `${metadata.manifest.displayName} could not look a title up`, { code: failure.code });
  };

  const ask = (userId: UserId, metadata: Metadata, target: Ask): Promise<KeptMove | undefined> => {
    const id = `${userId}|${itemKeyOf(target.key)}`;
    const asked = inflight.get(id);
    // Asked already, by another screen: that caller moves what was kept.
    if (asked) return asked.then(() => undefined);
    const work = (async () => {
      await slot();
      try {
        if (refused.has(metadata.fingerprint) || clock.now() < pausedUntil) return undefined;
        const ids = await (await providerOf(metadata)).identify(target.query);
        await db.identities.put(userId, { key: target.key, ...(ids ? { externalIds: ids } : {}), resolvedAt: clock.now() });
        return ids ? { from: target.from, to: target.to(ids), externalIds: ids } : undefined;
      } catch (error) {
        failed(metadata, error);
        return undefined;
      } finally {
        release();
        inflight.delete(id);
      }
    })();
    inflight.set(id, work);
    return work;
  };

  return {
    withKnownIds: async <T extends MediaItem>(userId: UserId, items: readonly T[]): Promise<readonly T[]> => {
      const keys = items.flatMap((item) => (item.type === 'movie' || item.type === 'show' ? [item.key] : item.type === 'season' || item.type === 'episode' ? [item.show] : []));
      if (keys.length === 0) return items;
      const known = new Map(
        (await db.identities.getMany(userId, keys)).flatMap((entry) => (entry.externalIds ? [[itemKeyOf(entry.key), entry.externalIds] as const] : [])),
      );
      if (known.size === 0) return items;
      return items.map((item): T => {
        if (item.type === 'movie' || item.type === 'show') {
          const ids = known.get(itemKeyOf(item.key));
          return ids ? { ...item, externalIds: { ...ids, ...item.externalIds } } : item;
        }
        if (item.type === 'season' || item.type === 'episode') {
          const ids = known.get(itemKeyOf(item.show));
          return ids ? { ...item, showExternalIds: { ...ids, ...item.showExternalIds } } : item;
        }
        return item;
      });
    },

    resolve: async (userId, items) => {
      if (items.length === 0 || clock.now() < pausedUntil) return false;
      try {
        const metadata = await metadataFor(userId);
        if (!metadata || refused.has(metadata.fingerprint)) return false;
        const identifies = metadata.manifest.metadata?.identifies ?? [];
        // A provider that keeps copies apart by language, on a tab the app keeps watch status on — a branch on category, never a name.
        const kept = new Set(
          (await sources.forUser(userId))
            .filter((source) => source.watch === 'app' && source.manifest.category === 'iptv')
            .map((source) => source.connection.id),
        );
        const asks = new Map<string, Ask>();
        for (const item of items) {
          if (!kept.has(item.key.connectionId)) continue;
          const target = askOf(item);
          if (target && identifies.includes(target.query.type === 'movie' ? 'movies' : 'shows')) asks.set(itemKeyOf(target.key), target);
        }
        if (asks.size === 0) return false;
        const known = new Map((await db.identities.getMany(userId, [...asks.values()].map((target) => target.key))).map((entry) => [itemKeyOf(entry.key), entry]));
        const due = [...asks].filter(([name]) => {
          const entry = known.get(name);
          return !entry || (!entry.externalIds && clock.now() - entry.resolvedAt >= MISS_FOR_MS);
        });
        if (due.length === 0) return false;
        const moves = (await Promise.all(due.map(([, target]) => ask(userId, metadata, target)))).flatMap((move) => (move ? [move] : []));
        if (moves.length === 0) return false;
        await db.transaction((tx) => moveKept(tx, userId, moves));
        return true;
      } catch (error) {
        log.warn('storage', 'Titles could not be looked up', { error: String(error) });
        return false;
      }
    },

    test: async (target, signal) => {
      const role = catalog.metadataRole(target.pluginId);
      if (!role) throw new AppError('INVALID_STATE', 'This adapter cannot look anything up yet.', { retry: 'never' });
      const credentials = await deps.probeSecrets(target.pluginId, target.connectionId, target.scope, target.secrets);
      // Its own installation id, and a session of its own: a probe touches nothing a running one holds.
      const provider = await role.connect(
        { connectionId: toConnectionId('probe'), fields: target.fields, settings: target.settings },
        await pluginContext(deps, `probe|${target.pluginId}`, async () => credentials, deps.sessions.ephemeral()),
      );
      try {
        return await provider.check(signal);
      } catch (error) {
        throw isAborted(error) ? error : toAppError(error, log);
      } finally {
        await provider.dispose();
      }
    },
  };
}

/**
 * What to ask about an item, if anything: a film or a series known only by its
 * title — a season or an episode by its series' — under the series' or the
 * film's own key, so one answer serves every episode.
 */
function askOf(item: MediaItem): Ask | undefined {
  const byTitle = { byTitle: true } as const;
  switch (item.type) {
    case 'movie':
    case 'show': {
      const from = watchIdentity(item, byTitle);
      if (!from.startsWith('title:')) return undefined;
      return {
        key: item.key,
        query: queryOf(item.type, item.title, item.originalTitle, item.year),
        from,
        to: (ids) => watchIdentity({ ...item, externalIds: { ...item.externalIds, ...ids } }, byTitle),
      };
    }
    case 'season':
    case 'episode': {
      const from = showIdentityOf(item, byTitle);
      if (from === undefined || !from.startsWith('title:') || item.showTitle === undefined) return undefined;
      return {
        key: item.show,
        query: queryOf('show', item.showTitle, item.showOriginalTitle, item.showYear),
        from,
        to: (ids) => showIdentityOf({ ...item, showExternalIds: { ...item.showExternalIds, ...ids } }, byTitle) ?? from,
      };
    }
    default:
      return undefined;
  }
}

/** A title as a catalogue is asked for it: without the provider's marks, and with the year it wrote into it where none is given. */
function queryOf(type: 'movie' | 'show', title: string, originalTitle: string | undefined, year: number | undefined): IdentifyQuery {
  const bare = bareTitle(title);
  const original = originalTitle === undefined ? undefined : bareTitle(originalTitle);
  const known = year ?? original?.year ?? bare.year;
  return {
    type,
    title: bare.title,
    ...(original && original.title !== '' ? { originalTitle: original.title } : {}),
    ...(known === undefined ? {} : { year: known }),
  };
}
