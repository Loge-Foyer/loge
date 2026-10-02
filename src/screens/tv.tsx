import { matchesTerm, type Channel, type ChannelGroup, type ConnectionId, type ContentKind, type MediaItem, type Programme } from '@sc/api';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { CalendarDays } from '@tamagui/lucide-icons-2/icons/CalendarDays';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Star } from '@tamagui/lucide-icons-2/icons/Star';
import { TvMinimalPlay } from '@tamagui/lucide-icons-2/icons/TvMinimalPlay';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, useWindowDimensions } from 'react-native';
import { SizableText, Spinner, XStack, YStack, useTheme } from 'tamagui';

import { ActionMenu } from '@/components/action-menu';
import { Artwork } from '@/components/artwork';
import { px } from '@/components/density';
import { EmptyState } from '@/components/empty-state';
import { CONTENT_KIND_LABELS, listNames } from '@/components/labels';
import { FAVORITES_GROUP, fromRouteId, isFavorites, liveHref, routeId } from '@/components/media/item-link';
import { PosterCard } from '@/components/media/poster-card';
import { SourceNotices } from '@/components/media/source-notices';
import { PrimaryButton } from '@/components/primary-button';
import { isTV, useRemoteFocus } from '@/components/remote';
import { Screen } from '@/components/screen';
import { SearchField } from '@/components/search-field';
import { usePosterWidth } from '@/components/shelf';
import { SourceTabs } from '@/components/source-tabs';
import { useServices } from '@/hooks/services-context';
import { useFavoriteChannels, useListActions } from '@/hooks/use-lists';
import { nowAndNext, useChannelGroups, useChannels, useGuide, useNow, useSourcePage } from '@/hooks/use-live';
import { useRefreshMedia } from '@/hooks/use-media';
import { useTabSources } from '@/hooks/use-sources';
import { categoryHref } from '@/screens/settings/plugin-route';
import { asChannel } from '@/services/lists';
import type { SourceError } from '@/services/media';
import type { TabSource } from '@/services/sources';

const NEWEST = { by: 'addedAt', order: 'desc' } as const;
// The guide is asked for the channels near the top of the list; the rest fill in as they come up.
const GUIDE_CHANNELS = 40;

/**
 * Live TV, and everything an IPTV provider brings — its films and series sit
 * beside its channels here, never in the library. One provider at a time: a
 * tab across the top for each, then Live, Movies and Series as it brings them.
 */
export function TvScreen() {
  const { data: sources } = useTabSources('tv');
  const params = useLocalSearchParams<{ source?: string; kind?: string; group?: string }>();
  const [term, setTerm] = useState('');
  const onTerm = useCallback((next: string) => setTerm(next), []);

  if (!sources) return <Screen>{null}</Screen>;
  if (sources.length === 0) return <TvEmptyState />;
  const selected = sources.find((source) => source.connection.id === params.source) ?? sources[0];
  if (!selected) return null;
  const kind = selected.kinds.find((each) => each === params.kind) ?? selected.kinds[0];
  // Each section searches its own: channels, films or series — never across them.
  const searchable = selected.effective.media?.capabilities.has('search') ?? false;
  const searchLabel = kind === 'live' ? 'Search channels' : kind ? `Search ${CONTENT_KIND_LABELS[kind].toLowerCase()}` : 'Search';

  const header = (
    <YStack gap="$3" pb="$3">
      {sources.length > 1 ? (
        <SourceTabs
          tabs={sources.map((source) => ({ id: source.connection.id, label: source.connection.label }))}
          selected={selected.connection.id}
          onSelect={(id) => {
            // Another provider is another list: a search does not follow.
            setTerm('');
            router.setParams({ source: id, kind: '', group: '' });
          }}
        />
      ) : null}
      {selected.kinds.length > 1 ? (
        <SourceTabs
          tabs={selected.kinds.map((each) => ({ id: each, label: each === 'live' ? 'Live' : CONTENT_KIND_LABELS[each] }))}
          selected={kind ?? ''}
          onSelect={(id) => {
            setTerm('');
            router.setParams({ kind: id });
          }}
        />
      ) : null}
      {searchable ? <SearchField key={`${selected.connection.id}:${kind}`} placeholder={searchLabel} term={term} onTerm={onTerm} /> : null}
    </YStack>
  );

  // Keyed by what a section lists, never by the term. The search box sits in
  // the list's header, so remounting the list for each term took the keyboard
  // away while someone was typing; a new term is a new query, which pages from
  // its start on its own.
  if (kind === 'live') {
    return <Live key={selected.connection.id} source={selected} group={params.group ? fromRouteId(params.group) : undefined} term={term} header={header} />;
  }
  return <SourceGrid key={`${selected.connection.id}:${kind}`} source={selected} kind={kind} term={term} header={header} />;
}

function TvEmptyState() {
  const { catalog } = useServices();
  const providers = catalog.inCategory('iptv').map((manifest) => manifest.displayName);
  // IPTV plugins leave out the platforms they cannot reach: in a browser, no provider is offered.
  if (providers.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon={<TvMinimalPlay size={26} color="$accent11" />}
          title="Live TV is in the app"
          body="IPTV providers can’t be reached from a browser. Add one in the app on your phone or tablet, and its channels, films and series appear there."
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <EmptyState
        icon={<TvMinimalPlay size={26} color="$accent11" />}
        title="Live TV starts here"
        body={`Add an IPTV source in Settings → Adapters → IPTV — ${listNames(providers)} — and its channels, films and series appear here.`}
      >
        <Link href={categoryHref('iptv')} asChild>
          <PrimaryButton size="$4" icon={Plus}>
            Add an IPTV source
          </PrimaryButton>
        </Link>
      </EmptyState>
    </Screen>
  );
}

function useRefresh() {
  const refresh = useRefreshMedia();
  const [refreshing, setRefreshing] = useState(false);
  const theme = useTheme();
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };
  return { onRefresh, control: <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={String(theme.color10.val)} /> };
}

function Live({ source, group, term, header }: { source: TabSource; group: string | undefined; term: string; header: React.ReactElement }) {
  const connectionId = source.connection.id;
  const favorites = isFavorites(group);
  const groups = useChannelGroups(connectionId);
  // The ★ list is the profile's own: the provider is asked for its guide, and nothing else.
  const channels = useChannels(connectionId, group, term, { enabled: !favorites });
  const kept = useFavoriteChannels(connectionId);
  const keptIds = new Map((kept.data ?? []).map((entry) => [entry.externalId, entry.id] as const));
  const searching = term.trim();
  const list = favorites
    ? (kept.data ?? []).map(asChannel).filter((channel) => (searching ? matchesTerm(searching, channel.name) : true))
    : (channels.data?.pages.flatMap((page) => page.value.channels) ?? []);
  const guide = useGuide(connectionId, list.slice(0, GUIDE_CHANNELS).map((channel) => channel.key));
  const now = useNow();
  const { onRefresh, control } = useRefresh();
  const errors = [groups.data?.sourceError, favorites ? undefined : channels.data?.pages[0]?.sourceError, guide.data?.sourceError].filter(
    (error): error is SourceError => error !== undefined,
  );
  const scroller = useRef<FlatList<Channel>>(null);
  useTopOnNewTerm(term, () => scroller.current?.scrollToOffset({ offset: 0, animated: false }));

  // What a long press — a held select, with a remote — was on, while its menu is up.
  const [held, setHeld] = useState<Channel>();
  const { favorite, unfavorite } = useListActions();
  const heldId = held ? keptIds.get(held.key.externalId) : undefined;
  const closeMenu = () => setHeld(undefined);
  const actions = held
    ? [heldId ? { label: 'Remove from Favorites', onPress: () => unfavorite.mutate(heldId) } : { label: 'Add to Favorites', onPress: () => favorite.mutate(held) }]
    : [];

  return (
    <>
      <FlatList
        ref={scroller}
        data={list}
        // The first tap after typing reaches a chip or ✕, rather than only putting the keyboard away.
        keyboardShouldPersistTaps="handled"
        keyExtractor={(channel) => channel.key.externalId}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 }}
        ListHeaderComponent={
          <YStack gap="$3" pb="$3">
            {header}
            <GroupChips groups={groups.data?.value ?? []} selected={group} />
            <SourceNotices errors={dedupe(errors)} onRetry={() => void onRefresh()} />
          </YStack>
        }
        renderItem={({ item }) => (
          <ChannelRow
            channel={item}
            connectionId={connectionId}
            group={group}
            programmes={guide.data?.value}
            now={now}
            favorite={keptIds.has(item.key.externalId)}
            onHold={setHeld}
          />
        )}
        ItemSeparatorComponent={() => <YStack height={10} />}
        ListEmptyComponent={
          favorites ? (
            kept.isPending ? null : (
              <SizableText color="$color10">
                {searching
                  ? 'No favourite matches that.'
                  : isTV
                    ? 'No favourites yet. Hold select on a channel to add it.'
                    : 'No favourites yet. Press and hold a channel to add it.'}
              </SizableText>
            )
          ) : channels.isPending ? (
            <YStack py="$8" items="center">
              <Spinner size="large" color="$accent9" />
            </YStack>
          ) : channels.error ? (
            <SizableText color="$color10">{channels.error.message}</SizableText>
          ) : (
            <SizableText color="$color10">No channels here.</SizableText>
          )
        }
        ListFooterComponent={!favorites && channels.isFetchingNextPage ? <Spinner color="$accent9" my="$5" /> : null}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!favorites && channels.hasNextPage && !channels.isFetchingNextPage) void channels.fetchNextPage();
        }}
        refreshControl={control}
      />
      <ActionMenu title={held?.name ?? ''} actions={actions} open={held !== undefined} onClose={closeMenu} />
    </>
  );
}

/** A new search starts at the top of its list. */
function useTopOnNewTerm(term: string, toTop: () => void) {
  const previous = useRef(term);
  useEffect(() => {
    if (previous.current === term) return;
    previous.current = term;
    toTop();
  });
}

function dedupe(errors: readonly SourceError[]): readonly SourceError[] {
  return errors.slice(0, 1);
}

function GroupChips({ groups, selected }: { groups: readonly ChannelGroup[]; selected: string | undefined }) {
  return (
    <SourceTabs
      tabs={[
        // The profile's own favourites, before any group of the provider's.
        { id: FAVORITES_GROUP, label: '', name: 'Favorites', icon: <Star size={px(14)} /> },
        { id: '', label: 'All' },
        ...groups.map((group) => ({ id: group.id, label: group.name })),
      ]}
      selected={selected ?? ''}
      onSelect={(id) => router.setParams({ group: routeId(id) })}
    />
  );
}

export function playChannel(channel: Channel, group: string | undefined) {
  router.push(liveHref(channel.key, channel.name, group));
}

function ChannelRow({
  channel,
  connectionId,
  group,
  programmes,
  now: at,
  favorite,
  onHold,
}: {
  channel: Channel;
  connectionId: ConnectionId;
  group: string | undefined;
  programmes: readonly Programme[] | undefined;
  now: number;
  /** One of this profile's favourites, marked with a ★. */
  favorite: boolean;
  /** A long press — or a held select — offers to add it to the favourites, or take it out. */
  onHold: (channel: Channel) => void;
}) {
  const { now, next } = nowAndNext(programmes, channel.key, at);
  const progress = now ? (at - Date.parse(now.startsAt)) / (Date.parse(now.endsAt) - Date.parse(now.startsAt)) : undefined;
  const row = useRemoteFocus();
  const guide = useRemoteFocus();
  return (
    <XStack gap="$3" items="center">
      <Pressable
        style={{ flex: 1 }}
        onPress={() => playChannel(channel, group)}
        onLongPress={() => onHold(channel)}
        accessibilityRole="button"
        accessibilityLabel={`Watch ${channel.name}${favorite ? ', a favourite' : ''}${now ? `, now ${now.title}` : ''}`}
        accessibilityHint={favorite ? 'Hold to remove it from your favourites' : 'Hold to add it to your favourites'}
        {...row.handlers}
      >
        {({ pressed }) => (
          <XStack gap="$3" items="center" opacity={pressed ? 0.75 : 1} bg={row.focused ? '$accent4' : '$color2'} rounded="$4" p="$2.5">
            <YStack width={px(72)} height={px(42)} rounded="$2" overflow="hidden" bg="$color3" items="center" justify="center">
              {channel.logo ? (
                <Artwork connectionId={connectionId} image={channel.logo} width={px(72)} aspect={72 / 42} label={channel.name} rounded="$3" fit="contain" />
              ) : (
                <SizableText size="$4" fontWeight="700" color="$color10">
                  {channel.number ?? channel.name.slice(0, 2)}
                </SizableText>
              )}
            </YStack>
            <YStack flex={1} gap="$1">
              <XStack items="center" gap="$1.5">
                <SizableText size="$4" fontWeight="600" color="$color12" numberOfLines={1} shrink={1}>
                  {channel.number === undefined ? channel.name : `${channel.number}  ${channel.name}`}
                </SizableText>
                {favorite ? <Star size={px(13)} color="$accent10" /> : null}
              </XStack>
              {now ? (
                <YStack gap="$1">
                  <SizableText size="$2" color="$color11" numberOfLines={1}>
                    {`${clockOf(now.startsAt)}  ${now.title}`}
                  </SizableText>
                  <YStack height={3} rounded={2} bg="$color4" overflow="hidden">
                    <YStack height="100%" width={`${Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)}%`} bg="$accent9" />
                  </YStack>
                </YStack>
              ) : null}
              {next ? (
                <SizableText size="$1" color="$color10" numberOfLines={1}>
                  {`Next ${clockOf(next.startsAt)}  ${next.title}`}
                </SizableText>
              ) : null}
            </YStack>
          </XStack>
        )}
      </Pressable>
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/tv/channel/[connectionId]/[channelId]',
            params: { connectionId, channelId: routeId(channel.key.externalId), name: channel.name, ...(group ? { group: routeId(group) } : {}) },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`Today on ${channel.name}`}
        hitSlop={8}
        {...guide.handlers}
      >
        <CalendarDays size={22} color={guide.focused ? '$accent11' : '$color10'} />
      </Pressable>
    </XStack>
  );
}

/** "20:15", in the device's own time. */
export function clockOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

function SourceGrid({ source, kind, term, header }: { source: TabSource; kind: ContentKind | undefined; term: string; header: React.ReactElement }) {
  const page = useSourcePage(source.connection.id, kind, NEWEST, term);
  const { width } = useWindowDimensions();
  const posterWidth = usePosterWidth();
  const { onRefresh, control } = useRefresh();
  const columns = Math.min(10, Math.max(3, Math.floor((width - 32 + 12) / (posterWidth + 12))));
  const cardWidth = Math.floor((width - 32 - (columns - 1) * 12) / columns);
  const items = page.data?.pages.flatMap((each) => each.items) ?? [];
  const errors = page.data?.pages[0]?.sourceError ? [page.data.pages[0].sourceError] : [];
  const scroller = useRef<FlashListRef<MediaItem>>(null);
  useTopOnNewTerm(term, () => scroller.current?.scrollToOffset({ offset: 0, animated: false }));
  return (
    <FlashList
      ref={scroller}
      key={columns}
      keyboardShouldPersistTaps="handled"
      data={items}
      numColumns={columns}
      keyExtractor={(item) => item.key.externalId}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 16, paddingBottom: 48 }}
      ListHeaderComponent={
        <YStack px={6} gap="$3" pb="$3">
          {header}
          <SourceNotices errors={errors} onRetry={() => void onRefresh()} />
        </YStack>
      }
      renderItem={({ item }) => (
        <YStack px={6} pb="$5" items="center">
          <PosterCard item={item} width={cardWidth} showWatch={false} />
        </YStack>
      )}
      ListEmptyComponent={
        page.isPending ? (
          <YStack py="$8" items="center">
            <Spinner size="large" color="$accent9" />
          </YStack>
        ) : (
          <SizableText px={6} color="$color10">
            {page.error ? page.error.message : 'Nothing here yet.'}
          </SizableText>
        )
      }
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
      }}
      refreshControl={control}
    />
  );
}

