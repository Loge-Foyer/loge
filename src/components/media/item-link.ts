import type { GlobalMediaKey, MediaItem, PluginId } from '@sc/api';
import type { Href } from 'expo-router';

/**
 * An adapter's id, made safe to put in a route. expo-router decodes a param
 * twice — once parsing the path or the query, and again in
 * `useLocalSearchParams` — so an id holding `%` came out changed: Stalker
 * encodes every part of its ids, a portal's own ids hold colons, and
 * `show:s:18390%3A18390` arrived as `show:s:18390:18390`, which its adapter
 * no longer knew. With `%` written `~25` there is nothing left to decode,
 * however many times expo-router does it; `~` becomes `~7E` so the escape
 * comes undone exactly.
 */
export function routeId(id: string): string {
  return id.replace(/[~%]/g, (character) => (character === '~' ? '~7E' : '~25'));
}

/** The id `routeId` put in a route, as the adapter made it. */
export function fromRouteId(param: string): string {
  return param.replace(/~(7E|25)/g, (_escape, code: string) => (code === '7E' ? '~' : '%'));
}

/** Where the page of whatever a key names is. */
export function keyHref(key: GlobalMediaKey): Href {
  return { pathname: '/item/[connectionId]/[itemId]', params: { connectionId: key.connectionId, itemId: routeId(key.externalId) } };
}

/** Where an item opens. A season opens its show, with that season chosen. */
export function itemHref(item: MediaItem): Href {
  if (item.type === 'season') {
    return {
      pathname: '/item/[connectionId]/[itemId]',
      params: { connectionId: item.show.connectionId, itemId: routeId(item.show.externalId), season: routeId(item.key.externalId) },
    };
  }
  return keyHref(item.key);
}

/** The player, for a film or an episode: from `startMs` when resuming, with one player when "Play with…" chose it. */
export function playHref(key: GlobalMediaKey, options: { readonly startMs?: number; readonly player?: PluginId } = {}): Href {
  return {
    pathname: '/play/[connectionId]/[itemId]',
    params: {
      connectionId: key.connectionId,
      itemId: routeId(key.externalId),
      ...(options.startMs ? { start: String(options.startMs) } : {}),
      ...(options.player ? { player: options.player } : {}),
    },
  };
}

/**
 * The group a channel opened from the ★ list zaps through: the profile's
 * favourites on its connection. Never a provider's group, so it never reaches
 * `listChannels` — a portal's genres are numbers, and no provider calls one ★.
 */
export const FAVORITES_GROUP = '★';

export const isFavorites = (group: string | undefined): boolean => group === FAVORITES_GROUP;

/** The player, for a channel: live, under its name, zapping through the group it was opened from. */
export function liveHref(channel: GlobalMediaKey, name: string, group: string | undefined): Href {
  return {
    pathname: '/play/[connectionId]/[itemId]',
    params: { connectionId: channel.connectionId, itemId: routeId(channel.externalId), live: '1', title: name, ...(group ? { group: routeId(group) } : {}) },
  };
}
