import type { ConnectionId, MediaItem } from '@loge/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { stableHash } from '@/services/hash';
import { userKey } from '@/services/query-keys';
import { itemKeyOf } from '@/services/watch/item-key';

import { useServices } from './services-context';
import { useActiveUserId } from './use-session';

/**
 * The watch state the app keeps, laid over these items where it is drawn — for
 * the ones whose source it keeps it for (`Source.watch`). It is local state, so
 * a mark shows at once, and nothing is asked of any source to show it.
 *
 * Drawn, they are also looked up: a metadata connection is asked what the
 * ones known only by their title are, in the background, and what it finds is
 * read again — which then asks nothing, every answer being kept.
 */
export function useKeptWatch(items: readonly MediaItem[]): (item: MediaItem) => MediaItem {
  const userId = useActiveUserId();
  const { watch, identity } = useServices();
  const client = useQueryClient();
  const { data } = useQuery({
    // The items' keys, as one short name: a list asks once, however long it is.
    queryKey: userKey(userId, 'kept-watch', stableHash(items.map((item) => itemKeyOf(item.key)).join('|'))),
    queryFn: () => {
      void identity.resolve(userId, items).then((changed) => {
        if (!changed) return;
        for (const part of ['kept-watch', 'in-progress'] as const) void client.invalidateQueries({ queryKey: userKey(userId, part) });
      });
      return watch.keptStatus(userId, items);
    },
    enabled: items.length > 0,
    networkMode: 'always',
    // A page more of the same list keeps what it showed while it asks.
    placeholderData: (previous) => previous,
  });
  return useCallback(
    (item: MediaItem) => {
      const status = data?.get(itemKeyOf(item.key));
      return status ? { ...item, watch: status } : item;
    },
    [data],
  );
}

/** What this profile has begun on one provider and not finished — what the TV tab lists first. */
export function useInProgress(connectionId: ConnectionId | undefined, type: 'movie' | 'show' | undefined, enabled = true) {
  const userId = useActiveUserId();
  const { watch } = useServices();
  return useQuery({
    queryKey: userKey(userId, 'in-progress', connectionId, type),
    queryFn: () => (connectionId && type ? watch.keptInProgress(userId, connectionId, type) : []),
    enabled: enabled && connectionId !== undefined && type !== undefined,
    networkMode: 'always',
  });
}
