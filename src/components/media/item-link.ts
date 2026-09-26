import type { MediaItem } from '@sc/api';
import type { Href } from 'expo-router';

/** Where an item opens. A season opens its show, with that season chosen. */
export function itemHref(item: MediaItem): Href {
  if (item.type === 'season') {
    return {
      pathname: '/item/[connectionId]/[itemId]',
      params: { connectionId: item.show.connectionId, itemId: item.show.externalId, season: item.key.externalId },
    };
  }
  return {
    pathname: '/item/[connectionId]/[itemId]',
    params: { connectionId: item.key.connectionId, itemId: item.key.externalId },
  };
}
