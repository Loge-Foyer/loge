import type { MediaItem } from '@sc/api';
import { FlashList } from '@shopify/flash-list';
import { Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { SizableText, Spinner, YStack, useTheme } from 'tamagui';

import { CustomizeButton } from '@/components/customize-button';
import { rowTitle } from '@/components/labels';
import { LandscapeCard } from '@/components/media/landscape-card';
import { PosterCard } from '@/components/media/poster-card';
import { SourceNotices } from '@/components/media/source-notices';
import { Screen } from '@/components/screen';
import { SearchField } from '@/components/search-field';
import { useLandscapeWidth, usePosterWidth } from '@/components/shelf';
import { useHomeRows } from '@/hooks/use-home-layout';
import { useGrid, useRefreshMedia } from '@/hooks/use-media';

const PADDING = 16;
const GAP = 12;

/**
 * Everything one row holds, as a grid over the whole screen. It pages as it
 * scrolls, in the row's own order; the columns follow the viewport, so the
 * same screen works from a phone to a television.
 */
export function BrowseScreen({ rowId }: { rowId: string }) {
  const { rows, sources } = useHomeRows();
  const row = rows?.find((candidate) => candidate.id === rowId);
  const kindRow = row?.type === 'kind' ? row : undefined;
  const [term, setTerm] = useState('');
  const searching = term.trim().length > 0;
  // A search stays inside this row's kind: films answer a search of films.
  const grid = useGrid(kindRow ? { kind: kindRow.kind, sort: kindRow.sort, ...(searching ? { term } : {}) } : undefined);
  const onTerm = useCallback((next: string) => setTerm(next), []);
  const refresh = useRefreshMedia();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const posterWidth = usePosterWidth();
  const landscapeWidth = useLandscapeWidth();
  const [refreshing, setRefreshing] = useState(false);

  if (!rows) return null;
  if (!kindRow) {
    return (
      <Screen>
        <SizableText color="$color10">This row is no longer on the home screen.</SizableText>
      </Screen>
    );
  }

  const card = kindRow.card;
  const target = card === 'poster' ? posterWidth : landscapeWidth;
  const columns = Math.min(12, Math.max(card === 'poster' ? 3 : 1, Math.floor((width - 2 * PADDING + GAP) / (target + GAP))));
  const cardWidth = Math.floor((width - 2 * PADDING - (columns - 1) * GAP) / columns);
  const items = grid.data?.pages.flatMap((page) => page.items) ?? [];
  const errors = grid.data?.pages.flatMap((page) => page.sourceErrors) ?? [];
  const total = grid.data?.pages[0]?.total;
  const watching = new Set(
    (sources ?? []).filter((source) => source.effective.media?.capabilities.has('watchStateRead')).map((source) => source.connection.id),
  );
  const showWatch = (item: MediaItem) => watching.has(item.key.connectionId);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: rowTitle(kindRow),
          headerRight: () => (
            <CustomizeButton href={{ pathname: '/customize-home', params: { row: kindRow.id } }} label="Sort this list" />
          ),
        }}
      />
      <FlashList
        // A new column count is a new layout, not an update of the old one.
        key={columns}
        data={items}
        numColumns={columns}
        keyExtractor={(item) => `${item.key.connectionId}:${item.key.externalId}`}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: PADDING - GAP / 2, paddingTop: 12, paddingBottom: 48 }}
        renderItem={({ item }) => (
          <YStack px={GAP / 2} pb="$5" items="center">
            {card === 'poster' ? (
              <PosterCard item={item} width={cardWidth} showWatch={showWatch(item)} />
            ) : (
              <LandscapeCard item={item} width={cardWidth} showWatch={showWatch(item)} />
            )}
          </YStack>
        )}
        ListHeaderComponent={
          <YStack px={GAP / 2} pb="$4" gap="$3">
            <SearchField placeholder={`Search ${rowTitle(kindRow).toLowerCase()}`} term={term} onTerm={onTerm} />
            {total === undefined ? null : (
              <SizableText size="$2" color="$color10">
                {total === 1 ? '1 title' : `${total} titles`}
              </SizableText>
            )}
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
    </>
  );
}
