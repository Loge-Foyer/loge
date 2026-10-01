import { AppError, type ConnectionId, type GlobalMediaKey, type MediaItem, type UserId } from '@sc/api';

import type { Clock, IdGenerator, LocalDatabase, Playlist, Subscription } from './ports';

/**
 * What a profile keeps for itself: the channels it follows, and the lists it
 * made. Account-wide — journaled, carried to your own server, written into
 * backups — because they are the profile's and belong wherever it signs in.
 *
 * A list may mix sources: a Jellyfin film beside a web video. Its items are
 * `GlobalMediaKey`s, so each knows which connection it came from.
 */
export interface ListsService {
  subscriptions(userId: UserId): Promise<readonly Subscription[]>;
  /** Following the same channel twice follows it once. */
  follow(userId: UserId, channel: MediaItem): Promise<Subscription>;
  unfollow(userId: UserId, id: string): Promise<void>;
  /** Whether this profile already follows it — what the button reads. */
  follows(userId: UserId, connectionId: ConnectionId, externalId: string): Promise<Subscription | undefined>;

  playlists(userId: UserId): Promise<readonly Playlist[]>;
  playlist(id: string): Promise<Playlist | undefined>;
  create(userId: UserId, title: string, options?: { readonly source?: GlobalMediaKey }): Promise<Playlist>;
  rename(id: string, title: string): Promise<void>;
  /** Adding something already in the list moves nothing: a list holds each item once. */
  add(id: string, key: GlobalMediaKey): Promise<void>;
  removeItem(id: string, key: GlobalMediaKey): Promise<void>;
  /** The whole order at once, which is how a list is edited. */
  reorder(id: string, keys: readonly GlobalMediaKey[]): Promise<void>;
  remove(id: string): Promise<void>;
}

const sameKey = (a: GlobalMediaKey, b: GlobalMediaKey) => a.connectionId === b.connectionId && a.externalId === b.externalId;

export function createListsService(deps: {
  readonly db: LocalDatabase;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}): ListsService {
  const { db, ids, clock } = deps;
  const now = () => new Date(clock.now()).toISOString();

  const edit = async (id: string, change: (playlist: Playlist) => Playlist): Promise<void> => {
    const playlist = await db.playlists.get(id);
    if (!playlist) throw new AppError('NOT_FOUND', 'That list is gone.', { retry: 'never' });
    const next = change(playlist);
    // A write that changes nothing writes nothing — and journals nothing.
    if (JSON.stringify({ ...next, version: 0, updatedAt: '' }) === JSON.stringify({ ...playlist, version: 0, updatedAt: '' })) return;
    await db.playlists.put({ ...next, updatedAt: now(), version: playlist.version + 1 });
  };

  return {
    subscriptions: (userId) => db.subscriptions.list(userId),

    follow: async (userId, channel) => {
      const { connectionId, externalId } = channel.key;
      const existing = await db.subscriptions.forChannel(userId, connectionId, externalId);
      if (existing) return existing;
      const subscription: Subscription = {
        id: ids.next(),
        userId,
        connectionId,
        externalId,
        // As it is now, so a list reads while the source is away.
        title: channel.title,
        addedAt: now(),
        version: 1,
      };
      await db.subscriptions.put(subscription);
      return subscription;
    },

    unfollow: (userId, id) => db.subscriptions.remove(id),
    follows: (userId, connectionId, externalId) => db.subscriptions.forChannel(userId, connectionId, externalId),

    playlists: (userId) => db.playlists.list(userId),
    playlist: (id) => db.playlists.get(id),

    create: async (userId, title, options = {}) => {
      const trimmed = title.trim();
      if (trimmed === '') throw new AppError('INVALID_STATE', 'A list needs a name.', { retry: 'never' });
      const playlist: Playlist = {
        id: ids.next(),
        userId,
        title: trimmed,
        items: [],
        ...(options.source ? { source: options.source } : {}),
        createdAt: now(),
        updatedAt: now(),
        version: 1,
      };
      await db.playlists.put(playlist);
      return playlist;
    },

    rename: (id, title) =>
      edit(id, (playlist) => {
        const trimmed = title.trim();
        if (trimmed === '') throw new AppError('INVALID_STATE', 'A list needs a name.', { retry: 'never' });
        return { ...playlist, title: trimmed };
      }),

    add: (id, key) =>
      edit(id, (playlist) =>
        playlist.items.some((item) => sameKey(item, key)) ? playlist : { ...playlist, items: [...playlist.items, key] },
      ),

    removeItem: (id, key) => edit(id, (playlist) => ({ ...playlist, items: playlist.items.filter((item) => !sameKey(item, key)) })),

    reorder: (id, keys) => edit(id, (playlist) => ({ ...playlist, items: keys })),

    remove: (id) => db.playlists.remove(id),
  };
}
