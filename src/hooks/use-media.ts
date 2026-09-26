import type { ConnectionId, GlobalMediaKey, HeadersRef, ImageRef, MediaItem } from '@sc/api';
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { PixelRatio } from 'react-native';

import type { MergeState, RowResult, RowSpec } from '@/services/media';
import { isRemoteKey, remoteKey, userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useActiveUserId } from './use-session';

export const ROW_LIMIT = 24;
const GRID_PAGE = 60;
const MINUTE = 60_000;

// What a source answered can go stale; local state cannot, and keeps the default.
const remote = {
  networkMode: 'always', // a home server answers without the internet, so never wait for "online"
  refetchOnWindowFocus: true,
} as const;

// A source that is starting up or overloaded is asked again, gently, until it answers.
const whileBackingOff = (result: RowResult | undefined) =>
  result?.sourceErrors.some((error) => error.retry === 'backoff') ? 30_000 : false;

export function useHomeRow(spec: RowSpec, enabled = true) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useQuery({
    queryKey: remoteKey(userId, 'row', spec.kind, spec.sort.by, spec.sort.order),
    queryFn: ({ signal }) => media.row(userId, spec, ROW_LIMIT, signal),
    staleTime: 5 * MINUTE,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => whileBackingOff(query.state.data),
    enabled,
    ...remote,
  });
}

/** Several rows at once, so the home can gather what every row could not reach into one notice. */
export function useHomeRowQueries(specs: readonly RowSpec[]) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useQueries({
    queries: specs.map((spec) => ({
      queryKey: remoteKey(userId, 'row', spec.kind, spec.sort.by, spec.sort.order),
      queryFn: ({ signal }: { signal: AbortSignal }) => media.row(userId, spec, ROW_LIMIT, signal),
      staleTime: 5 * MINUTE,
      placeholderData: keepPreviousData,
      refetchInterval: (query: { state: { data: RowResult | undefined } }) => whileBackingOff(query.state.data),
      ...remote,
    })),
  });
}

export function useContinueWatching(enabled = true) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useQuery({
    queryKey: remoteKey(userId, 'continue'),
    queryFn: ({ signal }) => media.continueWatching(userId, undefined, signal),
    staleTime: 30_000,
    refetchInterval: (query) => whileBackingOff(query.state.data),
    enabled,
    ...remote,
  });
}

export function useGrid(spec: RowSpec | undefined) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useInfiniteQuery({
    queryKey: remoteKey(userId, 'grid', spec?.kind, spec?.sort.by, spec?.sort.order),
    queryFn: ({ pageParam, signal }) => {
      if (!spec) throw new Error('No row to show.');
      return media.gridPage(userId, spec, pageParam, GRID_PAGE, signal);
    },
    initialPageParam: null as MergeState | null,
    getNextPageParam: (last) => last.next ?? null,
    staleTime: 5 * MINUTE,
    enabled: spec !== undefined,
    ...remote,
  });
}

export function useItem(key: GlobalMediaKey) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useQuery({
    queryKey: remoteKey(userId, 'item', key.connectionId, key.externalId),
    queryFn: ({ signal }) => media.item(userId, key, signal),
    staleTime: 2 * MINUTE,
    ...remote,
  });
}

export function useChildren(parent: MediaItem | undefined) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useQuery({
    queryKey: remoteKey(userId, 'children', parent?.key.connectionId, parent?.key.externalId),
    queryFn: ({ signal }) => {
      if (!parent) throw new Error('Nothing to list.');
      return media.children(userId, parent, signal);
    },
    staleTime: 2 * MINUTE,
    enabled: parent !== undefined,
    ...remote,
  });
}

/**
 * Where to fetch an image, sized for this screen. Memoized: a new source
 * object makes the web image component fetch again.
 */
export function useArtwork(connectionId: ConnectionId, ref: ImageRef | undefined, width: number, height?: number) {
  const userId = useActiveUserId();
  const { media } = useServices();
  const scale = PixelRatio.get();
  return useMemo(
    () =>
      ref
        ? media.artwork(userId, connectionId, ref, {
            width: Math.round(width * scale),
            ...(height === undefined ? {} : { height: Math.round(height * scale) }),
          })
        : null,
    [media, userId, connectionId, ref, width, height, scale],
  );
}

/** Headers an image needs, resolved in memory. Kept out of the remote keys: a refresh must not refetch every image. */
export function useArtworkHeaders(connectionId: ConnectionId, ref: HeadersRef | undefined) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useQuery({
    queryKey: userKey(userId, 'image-headers', connectionId, ref),
    queryFn: async () => (ref ? ((await media.artworkHeaders(userId, connectionId, ref)) ?? null) : null),
    enabled: ref !== undefined,
    ...remote,
  });
}

/** Mounted once for the signed-in app: a changed network means parked sources may answer now. */
export function useMediaEffects() {
  const { media } = useServices();
  const client = useQueryClient();
  useEffect(
    () =>
      media.subscribe(() => {
        void client.invalidateQueries({ predicate: (query) => isRemoteKey(query.queryKey) });
      }),
    [client, media],
  );
}

/** Pull to refresh: sources that were parked are tried again, and everything is asked afresh. */
export function useRefreshMedia() {
  const userId = useActiveUserId();
  const { media } = useServices();
  const client = useQueryClient();
  return useCallback(async () => {
    media.unpark();
    // A grid starts again from its first page rather than replaying every page it had.
    await client.resetQueries({ queryKey: remoteKey(userId, 'grid') });
    await client.invalidateQueries({ queryKey: remoteKey(userId) });
  }, [client, media, userId]);
}
