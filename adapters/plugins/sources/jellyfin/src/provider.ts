import {
  AppError,
  compareItems,
  headersRef,
  mergeSorted,
  selectsLibrary,
  type CancelSignal,
  type ConnectedMediaProvider,
  type ContentKind,
  type ItemPage,
  type Library,
  type MediaContext,
  type MediaItem,
  type MediaItemType,
  type MediaTarget,
} from '@sc/api';

import { createClient } from './client';
import { readChapters, readItem, readItemsPage, readMediaSegments, readPlaybackInfo, readPublicInfo } from './dto';
import { unreadable } from './errors';
import { resolveItemImage } from './images';
import { isLimited, scopeFor } from './libraries';
import { toDetail, toLibrary, toMediaItem } from './map';
import { pageAcross, readCursor, writeCursor } from './merge';
import { deviceProfile, TICKS_PER_MS, toDescriptor, type PlaySession } from './playback';
import { IMAGE_TYPES, ITEM_TYPE, itemsParams, LIST_FIELDS } from './query';
import { normalizeBaseUrl } from './url';

// Libraries change rarely; a limited selection needs them on every page.
const LIBRARIES_TTL_MS = 5 * 60_000;
const AUTH_HEADERS = headersRef('auth');
// What a transcode may use: anything at home, a modest stream on mobile data.
const HOME_BITRATE = 120_000_000;
const CELLULAR_BITRATE = 8_000_000;

export function createProvider(target: MediaTarget, context: MediaContext): ConnectedMediaProvider {
  const { connectionId, fields, settings } = target;
  const baseUrl = normalizeBaseUrl(typeof fields.serverUrl === 'string' ? fields.serverUrl : '');
  const client = createClient({
    baseUrl,
    username: typeof fields.username === 'string' ? fields.username : '',
    localOnly: fields.localOnly !== false,
    context,
  });
  const selection = settings.libraries;
  let libraries: { readonly at: number; readonly value: Promise<readonly Library[]> } | undefined;
  // What each item's reports name, from the descriptor that began its playback.
  const plays = new Map<string, PlaySession>();

  const report = (path: string, itemId: string, positionMs: number, extra: Readonly<Record<string, unknown>>, signal?: CancelSignal) => {
    const play = plays.get(itemId);
    return client.post(
      path,
      {},
      {
        ItemId: itemId,
        PositionTicks: Math.round(positionMs * TICKS_PER_MS),
        ...(play
          ? {
              MediaSourceId: play.mediaSourceId,
              ...(play.playSessionId ? { PlaySessionId: play.playSessionId } : {}),
              ...(play.audioStreamIndex === undefined ? {} : { AudioStreamIndex: play.audioStreamIndex }),
              ...(play.subtitleStreamIndex === undefined ? {} : { SubtitleStreamIndex: play.subtitleStreamIndex }),
            }
          : {}),
        ...extra,
      },
      signal,
    );
  };

  const fetchLibraries = async (signal?: CancelSignal): Promise<readonly Library[]> => {
    const userId = await client.userId(signal);
    const page = readItemsPage(await client.get('/UserViews', { userId, includeExternalContent: false }, signal));
    if (!page) throw unreadable();
    return page.items.flatMap((dto) => toLibrary(dto) ?? []);
  };

  // Shared by every caller, so it never takes one caller's signal.
  const knownLibraries = (): Promise<readonly Library[]> => {
    const now = context.clock.now();
    if (!libraries || now - libraries.at > LIBRARIES_TTL_MS) {
      const value = fetchLibraries();
      libraries = { at: now, value };
      value.catch(() => {
        if (libraries?.value === value) libraries = undefined;
      });
    }
    return libraries.value;
  };

  const scope = async (kind: ContentKind) => scopeFor(selection, isLimited(selection) ? await knownLibraries() : [], kind);

  const toPage = (json: unknown, expected?: MediaItemType): ItemPage => {
    const page = readItemsPage(json);
    if (!page) throw unreadable();
    return {
      items: page.items.flatMap((dto) => toMediaItem(dto, connectionId, expected) ?? []),
      ...(page.totalRecordCount === undefined ? {} : { total: page.totalRecordCount }),
    };
  };

  return {
    connectionId,

    check: async (signal) => {
      const info = readPublicInfo(await client.getPublic('/System/Info/Public', signal));
      if (!info) throw unreadable();
      // Signing in proves the account as well as the address.
      await client.get('/Users/Me', {}, signal);
      return info;
    },

    listItems: async (query, signal) => {
      const itemType = ITEM_TYPE[query.kind];
      if (!itemType) return { items: [] };
      const [userId, where] = await Promise.all([client.userId(signal), scope(query.kind)]);
      if (where.parents.length === 0) return { items: [], total: 0 };
      const page = await pageAcross(
        where.parents,
        readCursor(query.cursor, where.key, where.parents.length),
        query.limit,
        compareItems(query.sort),
        async (parentId, startIndex, limit) =>
          toPage(
            await client.get(
              '/Items',
              itemsParams({ userId, itemType: itemType.jellyfin, sort: query.sort, parentId, startIndex, limit, term: query.term }),
              signal,
            ),
            itemType.type,
          ),
      );
      return {
        items: page.items,
        ...(page.done ? {} : { nextCursor: writeCursor(where.key, page.offsets) }),
        ...(page.total === undefined ? {} : { total: page.total }),
      };
    },

    getItem: async (externalId, signal) => {
      const userId = await client.userId(signal);
      const dto = readItem(await client.get(`/Items/${encodeURIComponent(externalId)}`, { userId }, signal));
      const detail = dto && toDetail(dto, connectionId);
      if (!detail) throw new AppError('NOT_FOUND', 'The server no longer has this item.');
      return detail;
    },

    getChildren: async (parent, signal) => {
      const userId = await client.userId(signal);
      const common = { userId, enableUserData: true, imageTypeLimit: 1, enableImageTypes: IMAGE_TYPES, isMissing: false };
      if (parent.type === 'show') {
        const json = await client.get(
          `/Shows/${encodeURIComponent(parent.key.externalId)}/Seasons`,
          { ...common, fields: LIST_FIELDS },
          signal,
        );
        return toPage(json, 'season');
      }
      if (parent.type === 'season') {
        const json = await client.get(
          `/Shows/${encodeURIComponent(parent.show.externalId)}/Episodes`,
          { ...common, seasonId: parent.key.externalId, fields: [...LIST_FIELDS, 'Overview'] },
          signal,
        );
        return toPage(json, 'episode');
      }
      return { items: [] };
    },

    getLibraries: async (signal) => {
      const fresh = await fetchLibraries(signal);
      libraries = { at: context.clock.now(), value: Promise.resolve(fresh) };
      return fresh;
    },

    getResume: async (limit, signal) => {
      const [userId, known] = await Promise.all([
        client.userId(signal),
        isLimited(selection) ? knownLibraries() : Promise.resolve(undefined),
      ]);
      const parents = known
        ? known.filter((library) => selectsLibrary(selection, library.id)).map((library) => library.id)
        : [undefined];
      const lists = await Promise.all(
        parents.map(async (parentId) => {
          const json = await client.get(
            '/UserItems/Resume',
            {
              userId,
              parentId,
              limit,
              // Without these, newer servers also list half-watched series.
              mediaTypes: 'Video',
              includeItemTypes: ['Movie', 'Episode'],
              fields: LIST_FIELDS,
              enableUserData: true,
              imageTypeLimit: 1,
              enableImageTypes: IMAGE_TYPES,
            },
            signal,
          );
          return toPage(json).items;
        }),
      );
      return mergeSorted(lists, byLastPlayed, limit).map((entry) => entry.value);
    },

    getPlaybackDescriptor: async (request, signal) => {
      const itemId = request.key.externalId;
      const userId = await client.userId(signal);
      const maxBitrate = context.network.current() === 'cellular' ? CELLULAR_BITRATE : HOME_BITRATE;
      const audioStreamIndex = request.audioTrackId === undefined ? undefined : Number(request.audioTrackId);
      const subtitleStreamIndex = request.subtitleTrackId === undefined ? undefined : Number(request.subtitleTrackId);
      const json = await client.post(
        `/Items/${encodeURIComponent(itemId)}/PlaybackInfo`,
        { userId },
        {
          UserId: userId,
          DeviceProfile: deviceProfile(request.profile, maxBitrate),
          MaxStreamingBitrate: maxBitrate,
          ...(request.startMs ? { StartTimeTicks: Math.round(request.startMs * TICKS_PER_MS) } : {}),
          ...(audioStreamIndex === undefined || Number.isNaN(audioStreamIndex) ? {} : { AudioStreamIndex: audioStreamIndex }),
          ...(subtitleStreamIndex === undefined || Number.isNaN(subtitleStreamIndex) ? {} : { SubtitleStreamIndex: subtitleStreamIndex }),
          EnableDirectPlay: true,
          EnableDirectStream: true,
          EnableTranscoding: true,
          AllowVideoStreamCopy: true,
          AllowAudioStreamCopy: true,
          AutoOpenLiveStream: true,
        },
        signal,
      );
      const info = readPlaybackInfo(json);
      const token = client.token();
      if (!info || !token) throw unreadable();
      // Marks are worth having and never worth failing for: a server without
      // the segments endpoint, or an item nobody has analysed, simply plays.
      const [chapters, segments] = await Promise.all([
        client
          .get(`/Items/${encodeURIComponent(itemId)}`, { userId, fields: 'Chapters' }, signal)
          .then(readChapters)
          .catch(() => []),
        client
          .get(`/MediaSegments/${encodeURIComponent(itemId)}`, {}, signal)
          .then(readMediaSegments)
          .catch(() => []),
      ]);
      const { descriptor, session } = toDescriptor({ info, request, baseUrl, token, chapters, segments });
      plays.set(itemId, session);
      return descriptor;
    },

    // Reports are safe to repeat: the outbox may deliver one twice. After a
    // restart the play session is gone, and a report names the item alone —
    // which is all Jellyfin needs to keep the position.
    reportPlayback: async (playback, signal) => {
      const itemId = playback.key.externalId;
      const method = { PlayMethod: plays.get(itemId)?.playMethod ?? 'DirectPlay', CanSeek: true };
      switch (playback.kind) {
        case 'started':
          await report('/Sessions/Playing', itemId, playback.positionMs, { ...method, IsPaused: false }, signal);
          return;
        case 'progress':
          await report('/Sessions/Playing/Progress', itemId, playback.positionMs, { ...method, IsPaused: playback.paused, EventName: playback.paused ? 'Pause' : 'TimeUpdate' }, signal);
          return;
        case 'stopped':
          await report('/Sessions/Playing/Stopped', itemId, playback.positionMs, {}, signal);
          plays.delete(itemId);
          return;
      }
    },

    setPlayed: async (key, played, signal) => {
      const userId = await client.userId(signal);
      const path = `/UserPlayedItems/${encodeURIComponent(key.externalId)}`;
      if (played) await client.post(path, { userId }, undefined, signal);
      else await client.delete(path, { userId }, signal);
    },

    resolveImage: (ref, size) => resolveItemImage(baseUrl, ref, size),

    resolveHeaders: async (ref) => {
      if (ref !== AUTH_HEADERS) return undefined;
      const authorization = client.authorization();
      return authorization ? { Authorization: authorization } : undefined;
    },

    dispose: async () => {
      libraries = undefined;
      plays.clear();
    },
  };
}

function byLastPlayed(a: MediaItem, b: MediaItem): number {
  const time = (item: MediaItem) => Date.parse(item.watch?.lastPlayedAt ?? '') || 0;
  return time(b) - time(a) || (a.key.externalId < b.key.externalId ? -1 : 1);
}
