import { SEARCH_SCOPES, type ContentKind, type MediaItem, type SearchScope } from '@sc/api';
import { FlashList } from '@shopify/flash-list';
import { ListMusic } from '@tamagui/lucide-icons-2/icons/ListMusic';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { SizableText, Spinner, XStack, YStack, useTheme } from 'tamagui';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { CONTENT_KIND_LABELS, listKinds, listNames } from '@/components/labels';
import { ChannelCard } from '@/components/media/channel-card';
import { LandscapeCard } from '@/components/media/landscape-card';
import { SourceNotices } from '@/components/media/source-notices';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { SearchField } from '@/components/search-field';
import { useLandscapeWidth } from '@/components/shelf';
import { SourceTabs } from '@/components/source-tabs';
import { useServices } from '@/hooks/services-context';
import { useGrid, useRefreshMedia } from '@/hooks/use-media';
import { useTabSources } from '@/hooks/use-sources';
import { categoryHref } from '@/screens/settings/plugin-route';
import type { TabSource } from '@/services/sources';
import { TAB_CONTENT } from '@/services/tab-content';

const PADDING = 16;
const GAP = 12;

/** What a search may be narrowed to, as the selector names it. */
const SCOPE_LABELS: Readonly<Record<SearchScope, string>> = {
  all: 'All',
  video: 'Video',
  channel: 'Channel',
  playlist: 'Playlist',
};

/**
 * Web video and plain files, one source at a time — a tab across the top for
 * each, and a second row of tabs when one source brings more than one kind.
 * What a source shows follows the kinds it brings, never its plugin.
 */
export function VideosScreen() {
  const { data: sources } = useTabSources('videos');
  const params = useLocalSearchParams<{ source?: string; kind?: string }>();

  if (!sources) return <Screen>{null}</Screen>;
  if (sources.length === 0) return <VideosEmptyState />;

  const selected = sources.find((source) => source.connection.id === params.source) ?? sources[0];
  if (!selected) return null;
  const kind = selected.kinds.find((candidate) => candidate === params.kind) ?? selected.kinds[0];
  if (!kind) return null;

  return (
    <SourceVideos
      // A different source or kind is a different list, not an update of the
      // old one: remounting drops the previous term and scroll position.
      key={`${selected.connection.id}:${kind}`}
      sources={sources}
      selected={selected}
      kind={kind}
    />
  );
}

function SourceVideos({
  sources,
  selected,
  kind,
}: {
  sources: readonly TabSource[];
  selected: TabSource;
  kind: ContentKind;
}) {
  const [term, setTerm] = useState('');
  const searching = term.trim().length > 0;
  // What this source's search can be narrowed to, in the selector's order; "All" first where it has it.
  const scopes = SEARCH_SCOPES.filter((each) => selected.manifest.media?.searchScopes?.includes(each) ?? false);
  const [scope, setScope] = useState<SearchScope | undefined>(scopes[0]);
  const grid = useGrid({
    kind,
    sort: { by: 'addedAt', order: 'desc' },
    connectionId: selected.connection.id,
    ...(searching ? { term, ...(scope === undefined ? {} : { scope }) } : {}),
  });
  const onTerm = useCallback((next: string) => setTerm(next), []);
  const refresh = useRefreshMedia();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const cardTarget = useLandscapeWidth();
  const [refreshing, setRefreshing] = useState(false);

  const columns = Math.min(12, Math.max(1, Math.floor((width - 2 * PADDING + GAP) / (cardTarget + GAP))));
  const cardWidth = Math.floor((width - 2 * PADDING - (columns - 1) * GAP) / columns);
  const items = grid.data?.pages.flatMap((page) => page.items) ?? [];
  const errors = grid.data?.pages.flatMap((page) => page.sourceErrors) ?? [];
  // Only a source that masters watch status has any to show.
  const showWatch = selected.effective.media?.capabilities.has('watchStateRead') ?? false;
  const canSearch = selected.effective.media?.capabilities.has('search') ?? false;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <FlashList
      // A new column count is a new layout, not an update of the old one.
      key={columns}
      // The first tap after typing reaches a tab or ✕, rather than only putting the keyboard away.
      keyboardShouldPersistTaps="handled"
      data={items}
      numColumns={columns}
      keyExtractor={(item: MediaItem) => `${item.key.connectionId}:${item.key.externalId}`}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: PADDING - GAP / 2, paddingTop: 12, paddingBottom: 48 }}
      renderItem={({ item }: { item: MediaItem }) => (
        <YStack px={GAP / 2} pb="$5" items="center">
          {item.type === 'channel' ? <ChannelCard item={item} width={cardWidth} /> : <LandscapeCard item={item} width={cardWidth} showWatch={showWatch} />}
        </YStack>
      )}
      ListHeaderComponent={
        <YStack px={GAP / 2} pb="$4" gap="$3">
          {sources.length > 1 ? (
            <SourceTabs
              tabs={sources.map((source) => ({ id: source.connection.id, label: source.connection.label }))}
              selected={selected.connection.id}
              onSelect={(id) => router.setParams({ source: id, kind: undefined })}
            />
          ) : null}
          {selected.kinds.length > 1 ? (
            <SourceTabs
              tabs={selected.kinds.map((candidate) => ({ id: candidate, label: CONTENT_KIND_LABELS[candidate] }))}
              selected={kind}
              onSelect={(next) => router.setParams({ kind: next })}
            />
          ) : null}
          {canSearch ? (
            // Each search is a request to the source, so only the search key sends one.
            <SearchField
              placeholder={`Search ${CONTENT_KIND_LABELS[kind].toLowerCase()}`}
              term={term}
              onTerm={onTerm}
              searchOn="submit"
              {...(scope === undefined || scopes.length < 2
                ? {}
                : { scope: { value: scope, options: scopes, label: (option: SearchScope) => SCOPE_LABELS[option], onChange: setScope } })}
            />
          ) : null}
          <XStack>
            <Link href="/lists" asChild>
              <Button size="$3" icon={<ListMusic size={16} />}>
                Following and lists
              </Button>
            </Link>
          </XStack>
          <SourceNotices errors={errors} onRetry={() => void onRefresh()} />
        </YStack>
      }
      ListEmptyComponent={
        grid.isPending ? (
          <YStack py="$8" items="center">
            <Spinner size="large" color="$accent9" />
          </YStack>
        ) : (
          <SizableText px={GAP / 2} color="$color10">
            {searching ? 'Nothing here matches that.' : 'Nothing here yet.'}
          </SizableText>
        )
      }
      ListFooterComponent={
        grid.isFetchingNextPage ? (
          <YStack py="$5" items="center">
            <Spinner color="$accent9" />
          </YStack>
        ) : null
      }
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (grid.hasNextPage && !grid.isFetchingNextPage) void grid.fetchNextPage();
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={String(theme.color10.val)} />}
    />
  );
}

function VideosEmptyState() {
  const { catalog } = useServices();
  const names = catalog.showingOn('videos').map((manifest) => manifest.displayName);
  return (
    <Screen>
      <EmptyState
        icon={<Tv size={26} color="$accent11" />}
        title="Nothing to watch here yet"
        body={`Connect a source that brings ${listKinds(TAB_CONTENT.videos)}${names.length > 0 ? ` — ${listNames(names)}` : ''}. Each one gets its own tab here.`}
      >
        <Link href={categoryHref('sources')} asChild>
          <PrimaryButton size="$4" icon={Plus}>
            Add a source
          </PrimaryButton>
        </Link>
      </EmptyState>
    </Screen>
  );
}
