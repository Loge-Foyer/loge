import {
  AppError,
  compareItems,
  selectsLibrary,
  type ConnectedMediaProvider,
  type MediaContext,
  type MediaItem,
  type MediaTarget,
} from '@sc/api';

import { CHILD_PAGE, createCatalogue, kindOf, type CatalogueSize } from './catalogue';

const SLOW_MS = 1_500;

export function createProvider(target: MediaTarget, context: MediaContext): ConnectedMediaProvider {
  const { connectionId, fields, settings } = target;
  const size: CatalogueSize = fields.catalogueSize === 'large' ? 'large' : 'small';
  const catalogue = createCatalogue(connectionId, size);
  const selection = settings.libraries;
  let calls = 0;

  // Latency is simulated where a real server would be slow or fail: every call.
  const respond = async <T>(answer: () => T): Promise<T> => {
    calls += 1;
    if (settings.latency === 'slow') await context.clock.sleep(SLOW_MS);
    if (settings.latency === 'flaky' && calls % 3 === 0) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'The mock is pretending to be down.', { retry: 'backoff' });
    }
    return answer();
  };

  const visible = catalogue.entries.filter((entry) => selectsLibrary(selection, entry.libraryId));

  return {
    connectionId,

    check: () =>
      respond(() => ({
        serverName: typeof fields.libraryName === 'string' && fields.libraryName !== '' ? fields.libraryName : 'Mock library',
        version: 'mock',
      })),

    listItems: (query) =>
      respond(() => {
        const all = (query.kind === 'videos' ? catalogue.videos : visible.map((entry) => entry.item).filter((item) => kindOf(item) === query.kind))
          .slice()
          .sort(compareItems(query.sort));
        const offset = query.cursor ? Number(query.cursor) : 0;
        const items = all.slice(offset, offset + query.limit);
        const next = offset + items.length;
        return { items, total: all.length, ...(next < all.length ? { nextCursor: String(next) } : {}) };
      }),

    getItem: (externalId) =>
      respond(() => {
        const detail = catalogue.details.get(externalId);
        if (detail) return detail;
        const child = [...catalogue.seasons.values(), ...catalogue.episodes.values()]
          .flat()
          .find((item) => item.key.externalId === externalId);
        if (!child) throw new AppError('NOT_FOUND', 'The mock has no such item.');
        return { item: child, people: [], studios: [] };
      }),

    getChildren: (parent, _signal, query) =>
      respond(() => {
        const held = catalogue.holds.get(parent.key.externalId);
        if (held) {
          // A channel's sections and a playlist's videos, a few at a time.
          const all = held.get(query?.section ?? 'videos') ?? [];
          const offset = query?.cursor ? Number(query.cursor) : 0;
          const items = all.slice(offset, offset + CHILD_PAGE);
          const next = offset + items.length;
          return { items, total: all.length, ...(next < all.length ? { nextCursor: String(next) } : {}) };
        }
        const children: readonly MediaItem[] =
          parent.type === 'show'
            ? (catalogue.seasons.get(parent.key.externalId) ?? [])
            : parent.type === 'season'
              ? (catalogue.episodes.get(parent.key.externalId) ?? [])
              : [];
        return { items: children, total: children.length };
      }),

    getLibraries: () => respond(() => catalogue.libraries),

    getResume: (limit) =>
      respond(() => {
        const movies = visible.map((entry) => entry.item).filter((item) => item.type === 'movie');
        const shows = new Set(visible.filter((entry) => entry.item.type === 'show').map((entry) => entry.item.key.externalId));
        const episodes = [...catalogue.episodes.values()].flat().filter((episode) => shows.has(episode.show.externalId));
        return [...movies, ...episodes]
          .filter((item) => item.watch?.positionMs !== undefined && !item.watch.played)
          .sort((a, b) => (b.watch?.lastPlayedAt ?? '').localeCompare(a.watch?.lastPlayedAt ?? ''))
          .slice(0, limit);
      }),

    dispose: async () => {},
  };
}
