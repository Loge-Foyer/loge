import type { MediaItem } from '@loge/api';
import { FlashList } from '@shopify/flash-list';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { SizableText, Spinner, YStack, useTheme } from 'tamagui';

import { rowTitle } from '@/components/labels';
import { titleHref } from '@/components/media/item-link';
import { LandscapeCard } from '@/components/media/landscape-card';
import { PosterCard } from '@/components/media/poster-card';
import { SourceNotices } from '@/components/media/source-notices';
import { isTV } from '@/components/remote';
import { Screen } from '@/components/screen';
import { useLandscapeWidth, usePosterWidth } from '@/components/shelf';
import { useHomeRows } from '@/hooks/use-home-layout';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useGrid, useRefreshMedia } from '@/hooks/use-media';
import { filterRow, FILTER_ROW_ID, isFiltered, narrowRow } from '@/services/home-filter';
import { specOf } from '@/services/home-layout';

import { CustomizeButton } from './customize-button';
import { filterOf } from './links';

const PADDING = 16;
const GAP = 12;

/**
 * Everything one row holds, as a grid over the whole screen — narrowed as the
 * home was when it was opened (`kind`, `genre`), and the filter's own row by
 * its id. It pages as it scrolls, in the row's own order; the columns follow
 * the viewport, so the same screen works from a phone to a television. It has
 * no search box: Media's search is the home's, at its top right.
 */
export function BrowseScreen({ rowId, kind, genre }: { rowId: string; kind?: string; genre?: string }) {
  const { rows, sources } = useHomeRows();
  const filter = filterOf({ ...(kind ? { kind } : {}), ...(genre ? { genre } : {}) });
  const stored = rows?.find((candidate) => candidate.id === rowId);
  const kindRow =
    rowId === FILTER_ROW_ID ? filterRow(filter) : stored?.type === 'titles' ? (isFiltered(filter) ? narrowRow(stored, filter) : stored) : undefined;
  const grid = useGrid(kindRow ? specOf(kindRow) : undefined);
  const refresh = useRefreshMedia();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const posterWidth = usePosterWidth();
  const landscapeWidth = useLandscapeWidth();
  const [refreshing, setRefreshing] = useState(false);
  const items = grid.data?.pages.flatMap((page) => page.items) ?? [];
  const withKept = useKeptWatch(items);

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
  const errors = grid.data?.pages.flatMap((page) => page.sourceErrors) ?? [];
  const total = grid.data?.pages[0]?.total;
  // Whoever keeps it — the source, or the app for one that keeps none.
  const watching = new Set((sources ?? []).filter((source) => source.watch !== undefined).map((source) => source.connection.id));
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
          // The filter's own row is the home's for a moment, not one of the profile's to sort.
          headerRight: () =>
            stored && rowId !== FILTER_ROW_ID ? <CustomizeButton href={{ pathname: '/customize-home', params: { row: kindRow.id } }} label="Sort this list" /> : null,
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
        renderItem={({ item, index }) => (
          <YStack px={GAP / 2} pb="$5" items="center">
            {card === 'poster' ? (
              <PosterCard item={withKept(item)} width={cardWidth} showWatch={showWatch(item)} href={titleHref(item)} preferred={isTV && index === 0} />
            ) : (
              <LandscapeCard item={withKept(item)} width={cardWidth} showWatch={showWatch(item)} href={titleHref(item)} preferred={isTV && index === 0} />
            )}
          </YStack>
        )}
        ListHeaderComponent={
          <YStack px={GAP / 2} pb="$4" gap="$3">
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
              Nothing here yet.
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
