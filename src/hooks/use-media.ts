import type { ConnectionId, GlobalMediaKey, HeadersRef, ImageRef, MediaItem } from '@sc/api';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { PixelRatio } from 'react-native';

import type { GridPage, MergeState, RowResult, RowSpec } from '@/services/media';
import { isRemoteKey, remoteKey, userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useActiveUserId } from './use-session';

export const ROW_LIMIT = 24;
const GRID_PAGE = 60;
const MINUTE = 60_000;

// What a source answered can go stale; local state cannot, and keeps the default.
const remote = {
  refetchOnWindowFocus: true,
} as const;

// A source that is starting up or overloaded is asked again, gently, until it answers.
const whileBackingOff = (result: RowResult | undefined) =>
  result?.sourceErrors.some((error) => error.retry === 'backoff') ? 30_000 : false;

const rowKey = (spec: RowSpec) => [spec.kind, spec.sort.by, spec.sort.order] as const;

/**
 * Several rows at once, so the home can gather what every row could not reach
 * into one notice. Each row shows what was saved from last time while its
 * sources answer — a placeholder, so it never passes for a fresh answer.
 */
export function useHomeRowQueries(specs: readonly RowSpec[]) {
  const userId = useActiveUserId();
  const { media } = useServices();
  const saved = useQueries({
    queries: specs.map((spec) => ({
      queryKey: remoteKey(userId, 'saved', 'row', ...rowKey(spec)),
      queryFn: () => media.saved.row(userId, spec, ROW_LIMIT),
    })),
  });
  return useQueries({
    queries: specs.map((spec, index) => ({
      queryKey: remoteKey(userId, 'row', ...rowKey(spec)),
      queryFn: ({ signal }: { signal: AbortSignal }) => media.row(userId, spec, ROW_LIMIT, signal),
      staleTime: 5 * MINUTE,
      // Saved rows first; else, while the sort changes, the previous rows.
      placeholderData: (previous: RowResult | undefined) => saved[index]?.data ?? previous,
      refetchInterval: (query: { state: { data: RowResult | undefined } }) => whileBackingOff(query.state.data),
      ...remote,
    })),
  });
}

export function useContinueWatching(enabled = true) {
  const userId = useActiveUserId();
  const { media } = useServices();
  const saved = useQuery({
    queryKey: remoteKey(userId, 'saved', 'continue'),
    queryFn: () => media.saved.continueWatching(userId),
    enabled,
  });
  return useQuery<RowResult, Error, RowResult, readonly unknown[]>({
    queryKey: remoteKey(userId, 'continue'),
    queryFn: ({ signal }) => media.continueWatching(userId, undefined, signal),
    staleTime: 30_000,
    placeholderData: (previous: RowResult | undefined) => saved.data ?? previous,
    refetchInterval: (query) => whileBackingOff(query.state.data),
    enabled,
    ...remote,
  });
}

export function useGrid(spec: RowSpec | undefined) {
  const userId = useActiveUserId();
  const { media } = useServices();
  // Nothing was ever saved for a search, so nothing stands in for one.
  const searching = (spec?.term ?? '').trim().length > 0;
  const saved = useQuery({
    // Scoped to one source where the grid is: two sources' films are not one list.
    queryKey: remoteKey(userId, 'saved', 'grid', spec?.kind, spec?.sort.by, spec?.sort.order, spec?.connectionId),
    queryFn: () => (spec && !searching ? media.saved.gridFirstPage(userId, spec, GRID_PAGE) : null),
    enabled: spec !== undefined && !searching,
  });
  // A saved first page has no `next`, and a placeholder never counts for
  // `hasNextPage` — so the grid cannot page on from last week's positions.
  // A disabled query still holds what it had: while searching, the saved
  // catalogue must not stand in for the answer.
  const placeholder = useMemo(
    (): InfiniteData<GridPage, MergeState | null> | undefined =>
      saved.data && !searching ? { pages: [saved.data], pageParams: [null] } : undefined,
    [saved.data, searching],
  );
  return useInfiniteQuery({
    // The term and its scope are part of the key: one query's answers never show under another's.
    queryKey: remoteKey(
      userId,
      'grid',
      spec?.kind,
      spec?.sort.by,
      spec?.sort.order,
      spec?.connectionId,
      spec?.term?.trim() || undefined,
      searching ? spec?.scope : undefined,
    ),
    queryFn: ({ pageParam, signal }) => {
      if (!spec) throw new Error('No row to show.');
      return media.gridPage(userId, spec, pageParam, GRID_PAGE, signal);
    },
    initialPageParam: null as MergeState | null,
    getNextPageParam: (last) => last.next ?? null,
    staleTime: 5 * MINUTE,
    placeholderData: (_previous: InfiniteData<GridPage, MergeState | null> | undefined) => placeholder,
    enabled: spec !== undefined,
    ...remote,
  });
}

export function useItem(key: GlobalMediaKey, enabled = true) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useQuery({
    queryKey: remoteKey(userId, 'item', key.connectionId, key.externalId),
    queryFn: ({ signal }) => media.item(userId, key, signal),
    staleTime: 2 * MINUTE,
    enabled,
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
 * One section of an item's children — a channel's videos, its playlists — a
 * page at a time, for as long as the source has another.
 */
export function useChildPages(parent: MediaItem | undefined, section: string | undefined) {
  const userId = useActiveUserId();
  const { media } = useServices();
  return useInfiniteQuery({
    queryKey: remoteKey(userId, 'children', parent?.key.connectionId, parent?.key.externalId, 'pages', section),
    queryFn: ({ pageParam, signal }) => {
      if (!parent) throw new Error('Nothing to list.');
      return media.children(userId, parent, signal, { ...(section === undefined ? {} : { section }), ...(pageParam ? { cursor: pageParam } : {}) });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
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
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = height === undefined ? undefined : Math.round(height * scale);
  // The resolved image is the store's snapshot: asked again whenever a source
  // connects or answers, so a card drawn before its source could resolve it —
  // from what was saved, at launch — draws it once it can. A plain call would
  // not do: the React Compiler memoizes it by its arguments, and the first
  // null would stand for good. The service answers the same object for the
  // same address, so asking again changes nothing that has not changed.
  const resolved = useSyncExternalStore(media.subscribeArtwork, () =>
    ref ? media.artwork(userId, connectionId, ref, { width: pixelWidth, ...(pixelHeight === undefined ? {} : { height: pixelHeight }) }) : null,
  );
  useEffect(() => {
    if (ref && !resolved) media.prepareArtwork(userId, connectionId);
  }, [media, userId, connectionId, ref, resolved]);
  return resolved;
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

/**
 * Mounted once for the signed-in app. A changed network means parked sources
 * may answer now. A stop or a watched state changes Continue Watching, the
 * item and its season at once; rows and grids only go stale — refetching
 * every server for one film would be out of all proportion.
 */
export function useMediaEffects() {
  const { media, watch } = useServices();
  const client = useQueryClient();
  useEffect(
    () =>
      media.subscribe(() => {
        void client.invalidateQueries({ predicate: (query) => isRemoteKey(query.queryKey) });
      }),
    [client, media],
  );
  useEffect(
    () =>
      watch.subscribe(({ userId, key }) => {
        for (const part of ['continue', 'children'] as const) void client.invalidateQueries({ queryKey: remoteKey(userId, part) });
        void client.invalidateQueries({ queryKey: remoteKey(userId, 'saved', 'continue') });
        void client.invalidateQueries({ queryKey: remoteKey(userId, 'item', key.connectionId, key.externalId) });
        for (const part of ['row', 'grid'] as const) void client.invalidateQueries({ queryKey: remoteKey(userId, part), refetchType: 'none' });
      }),
    [client, watch],
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
