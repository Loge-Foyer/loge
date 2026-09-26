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
import { readItem, readItemsPage, readPublicInfo } from './dto';
import { unreadable } from './errors';
import { resolveItemImage } from './images';
import { isLimited, scopeFor } from './libraries';
import { toDetail, toLibrary, toMediaItem } from './map';
import { pageAcross, readCursor, writeCursor } from './merge';
import { IMAGE_TYPES, ITEM_TYPE, itemsParams, LIST_FIELDS } from './query';
import { normalizeBaseUrl } from './url';

// Libraries change rarely; a limited selection needs them on every page.
const LIBRARIES_TTL_MS = 5 * 60_000;
const AUTH_HEADERS = headersRef('auth');

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
              itemsParams({ userId, itemType: itemType.jellyfin, sort: query.sort, parentId, startIndex, limit }),
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

    resolveImage: (ref, size) => resolveItemImage(baseUrl, ref, size),

    resolveHeaders: async (ref) => {
      if (ref !== AUTH_HEADERS) return undefined;
      const authorization = client.authorization();
      return authorization ? { Authorization: authorization } : undefined;
    },

    dispose: async () => {
      libraries = undefined;
    },
  };
}

function byLastPlayed(a: MediaItem, b: MediaItem): number {
  const time = (item: MediaItem) => Date.parse(item.watch?.lastPlayedAt ?? '') || 0;
  return time(b) - time(a) || (a.key.externalId < b.key.externalId ? -1 : 1);
}
