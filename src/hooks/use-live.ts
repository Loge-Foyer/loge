import type { ConnectionId, ContentKind, GlobalMediaKey, ItemSort, Programme } from '@loge/api';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';

import { asChannel } from '@/services/lists';
import type { SourceError } from '@/services/media';
import { remoteKey, userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useFavoriteChannels } from './use-lists';
import { useActiveUserId } from './use-session';

const MINUTE = 60_000;
const CHANNEL_PAGE = 60;
// The guide's window starts on a five-minute mark, so the key — and the answer — hold for five minutes.
const GUIDE_STEP_MS = 5 * MINUTE;

/**
 * What was saved, standing in for a provider that could not answer, is old
 * news from the moment it arrives: nothing waits out the usual freshness to ask
 * again, and while the provider said to try later, it is asked in half a
 * minute — as the Media rows are. Before, one failure at launch kept its notice
 * up for ten minutes or half an hour.
 */
const BACKING_OFF_MS = 30_000;
const freshFor = (error: SourceError | undefined, fresh: number) => (error ? 0 : fresh);
const askAgain = (error: SourceError | undefined) => (error?.retry === 'backoff' ? BACKING_OFF_MS : false);
/** How many pages are asked for, looking for the channel playing, before giving up on finding it. */
export const PAGES_TO_FIND = 10;

export function useChannelGroups(connectionId: ConnectionId | undefined) {
  const userId = useActiveUserId();
  const { media } = useServices();
  // Nothing asked again for a screen another covers — the TV tab beneath the player most of all.
  const focused = useIsFocused();
  return useQuery({
    queryKey: remoteKey(userId, 'live', connectionId, 'groups'),
    queryFn: ({ signal }) => {
      if (!connectionId) throw new Error('No source.');
      return media.channelGroups(userId, connectionId, signal);
    },
    enabled: connectionId !== undefined,
    staleTime: (query) => freshFor(query.state.data?.sourceError, 30 * MINUTE),
    refetchInterval: (query) => focused && askAgain(query.state.data?.sourceError),
  });
}

/** A group's channels — every channel without one — page by page, in the source's own order. */
export function useChannels(connectionId: ConnectionId | undefined, groupId: string | undefined, term?: string, options: { enabled?: boolean } = {}) {
  const userId = useActiveUserId();
  const { media } = useServices();
  const focused = useIsFocused();
  const searching = (term ?? '').trim();
  return useInfiniteQuery({
    // The term is part of the key: one search's channels never show under another's.
    queryKey: remoteKey(userId, 'live', connectionId, 'channels', groupId ?? '*', searching || undefined),
    queryFn: ({ pageParam, signal }) => {
      if (!connectionId) throw new Error('No source.');
      return media.channels(
        userId,
        connectionId,
        { limit: CHANNEL_PAGE, ...(groupId ? { groupId } : {}), ...(pageParam ? { cursor: pageParam } : {}), ...(searching ? { term: searching } : {}) },
        signal,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.value.nextCursor ?? null,
    enabled: connectionId !== undefined && options.enabled !== false,
    staleTime: (query) => freshFor(query.state.data?.pages[0]?.sourceError, 10 * MINUTE),
    refetchInterval: (query) => focused && askAgain(query.state.data?.pages[0]?.sourceError),
  });
}

/**
 * The channels around one, as the player zaps and lists them: its group's,
 * page by page — the very pages the TV tab holds — or the profile's
 * favourites, when it was opened from the ★ list. `at` is where the channel
 * stands among those loaded, -1 until a page holds it.
 */
export function useLineup(channel: GlobalMediaKey | undefined, group: string | undefined, favorites: boolean) {
  const channels = useChannels(channel?.connectionId, group, undefined, { enabled: !favorites && channel !== undefined });
  const kept = useFavoriteChannels(favorites ? channel?.connectionId : undefined);
  const list = favorites ? (kept.data ?? []).map(asChannel) : (channels.data?.pages.flatMap((page) => page.value.channels) ?? []);
  const more = !favorites && channels.hasNextPage;
  const fetchingMore = channels.isFetchingNextPage;
  return {
    list,
    at: channel ? list.findIndex((each) => each.key.externalId === channel.externalId) : -1,
    settled: favorites ? !kept.isPending : !channels.isPending,
    pages: channels.data?.pages.length ?? 0,
    more,
    fetchingMore,
    loadMore: () => {
      if (more && !fetchingMore) void channels.fetchNextPage();
    },
  };
}

/**
 * A lineup paged on until the channel playing turns up in it — for a while:
 * past `PAGES_TO_FIND` pages, a big group's later ones wait for the list's
 * end. Zapping and the channel list both need to know where it stands.
 */
export function useLineupAround(channel: GlobalMediaKey | undefined, group: string | undefined, favorites: boolean) {
  const lineup = useLineup(channel, group, favorites);
  const found = lineup.at >= 0;
  const pageOn = useEffectEvent(() => lineup.loadMore());
  useEffect(() => {
    if (channel && lineup.settled && !found && lineup.more && !lineup.fetchingMore && lineup.pages < PAGES_TO_FIND) pageOn();
  }, [channel, lineup.settled, found, lineup.more, lineup.fetchingMore, lineup.pages]);
  return { ...lineup, found, ready: lineup.settled && (found || !lineup.more || lineup.pages >= PAGES_TO_FIND) };
}

/** The Live group this profile chose last on a provider, on this device: `null` for none. */
export function useLastLiveGroup(connectionId: ConnectionId) {
  const userId = useActiveUserId();
  const { liveGroups } = useServices();
  return useQuery({ queryKey: userKey(userId, 'live-group', connectionId), queryFn: () => liveGroups.last(userId, connectionId) });
}

/** Remembers a group chosen on a provider — never ★, which comes first by itself while it holds anything. */
export function useRememberLiveGroup(connectionId: ConnectionId) {
  const userId = useActiveUserId();
  const { liveGroups } = useServices();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (group: string) => liveGroups.remember(userId, connectionId, group),
    onSuccess: () => client.invalidateQueries({ queryKey: userKey(userId, 'live-group', connectionId) }),
  });
}

/**
 * The time, held in state and moved on every `stepMs`: render stays pure, and
 * what shows the time follows it. Still while its screen is covered — the TV
 * tab beneath the player redrew every row of its list twice a minute — and
 * moved on at once when it is in front again.
 */
export function useNow(stepMs = 30_000) {
  const focused = useIsFocused();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!focused) return;
    const tick = () => setNow(Date.now());
    const soon = setTimeout(tick, 0);
    const timer = setInterval(tick, stepMs);
    return () => {
      clearTimeout(soon);
      clearInterval(timer);
    };
  }, [stepMs, focused]);
  return now;
}

/** What the channels air from now — or from `from` — for `hours`, refreshed as the programmes turn over. */
export function useGuide(connectionId: ConnectionId | undefined, channels: readonly GlobalMediaKey[], options: { hours?: number; from?: number } = {}) {
  const userId = useActiveUserId();
  const { media } = useServices();
  const focused = useIsFocused();
  const now = useNow(GUIDE_STEP_MS);
  const start = options.from ?? Math.floor(now / GUIDE_STEP_MS) * GUIDE_STEP_MS;
  const from = new Date(start).toISOString();
  const to = new Date(start + (options.hours ?? 3) * 60 * MINUTE).toISOString();
  return useQuery({
    queryKey: remoteKey(userId, 'live', connectionId, 'guide', channels.map((channel) => channel.externalId).join(','), from, to),
    queryFn: ({ signal }) => {
      if (!connectionId) throw new Error('No source.');
      return media.guide(userId, connectionId, channels, from, to, signal);
    },
    enabled: connectionId !== undefined && channels.length > 0,
    staleTime: (query) => freshFor(query.state.data?.sourceError, 5 * MINUTE),
    refetchInterval: (query) => focused && (askAgain(query.state.data?.sourceError) || 5 * MINUTE),
  });
}

/** Now and next for one channel, out of a guide's programmes. */
export function nowAndNext(programmes: readonly Programme[] | undefined, channel: GlobalMediaKey, at: number) {
  const own = (programmes ?? [])
    .filter((programme) => programme.channel.externalId === channel.externalId && Date.parse(programme.endsAt) > at)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const [first, second] = own;
  const airing = first && Date.parse(first.startsAt) <= at ? first : undefined;
  return { now: airing, next: airing ? second : first };
}

/** One source's films or series, page by page, in the source's own order. */
export function useSourcePage(connectionId: ConnectionId | undefined, kind: ContentKind | undefined, sort: ItemSort, term?: string) {
  const userId = useActiveUserId();
  const { media } = useServices();
  const focused = useIsFocused();
  const searching = (term ?? '').trim();
  return useInfiniteQuery({
    queryKey: remoteKey(userId, 'source', connectionId, kind, sort.by, sort.order, searching || undefined),
    queryFn: ({ pageParam, signal }) => {
      if (!connectionId || !kind) throw new Error('Nothing to list.');
      return media.sourcePage(
        userId,
        connectionId,
        { kind, sort, limit: CHANNEL_PAGE, ...(pageParam ? { cursor: pageParam } : {}), ...(searching ? { term: searching } : {}) },
        signal,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
    enabled: connectionId !== undefined && kind !== undefined,
    staleTime: (query) => freshFor(query.state.data?.pages[0]?.sourceError, 10 * MINUTE),
    refetchInterval: (query) => focused && askAgain(query.state.data?.pages[0]?.sourceError),
  });
}
