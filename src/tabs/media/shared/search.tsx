import type { MediaItem } from '@loge/api';
import { FlashList } from '@shopify/flash-list';
import { ChevronLeft } from '@tamagui/lucide-icons-2/icons/ChevronLeft';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';
import { titleHref } from '@/components/media/item-link';
import { PosterCard } from '@/components/media/poster-card';
import { RowTitle } from '@/components/media/row-title';
import { SourceNotices } from '@/components/media/source-notices';
import { isTV } from '@/components/remote';
import { SearchField } from '@/components/search-field';
import { usePosterWidth } from '@/components/shelf';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useGrid } from '@/hooks/use-media';
import { useTabSources } from '@/hooks/use-sources';
import { TAB_CONTENT } from '@/services/tab-content';

const GAP = px(8);
const ALPHABETICAL = { by: 'title', order: 'asc' } as const;

/**
 * Media's search: every film, series and anime the sources hold, as posters.
 * It asks once typing pauses, or at once on the search key; only sources that
 * can search are asked, and nothing of it is kept.
 */
export function MediaSearch() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const target = usePosterWidth();
  const [term, setTerm] = useState('');
  const onTerm = useCallback((next: string) => setTerm(next), []);
  const searching = term.trim().length > 0;
  const grid = useGrid(searching ? { kinds: TAB_CONTENT.media, sort: ALPHABETICAL, term } : undefined);
  const { data: sources = [] } = useTabSources('media');
  const watching = new Set(sources.filter((source) => source.watch !== undefined).map((source) => source.connection.id));
  const items = searching ? (grid.data?.pages.flatMap((page) => page.items) ?? []) : [];
  const withKept = useKeptWatch(items);
  const errors = grid.data?.pages.flatMap((page) => page.sourceErrors) ?? [];
  // Three across at least, as many as the width allows.
  const columns = Math.max(3, Math.floor((width - 2 * GUTTER + GAP) / (target + GAP)));
  const cardWidth = Math.floor((width - 2 * GUTTER - (columns - 1) * GAP) / columns);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/media'));

  return (
    <YStack flex={1} bg="$background" pt={insets.top + px(8)}>
      <XStack px={GUTTER} gap="$2" items="center" pb="$3">
        {isTV ? null : <Button size="$3" circular chromeless icon={ChevronLeft} aria-label="Back" onPress={back} />}
        <YStack flex={1}>
          <SearchField placeholder="Search movies and shows" term={term} onTerm={onTerm} autoFocus />
        </YStack>
      </XStack>
      <FlashList<MediaItem>
        key={columns}
        data={items.map(withKept)}
        numColumns={columns}
        keyExtractor={(item) => `${item.key.connectionId}|${item.key.externalId}`}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + px(32) }}
        ListHeaderComponent={
          <YStack gap="$3" pb="$3">
            {searching && items.length > 0 ? <RowTitle>Movies & shows</RowTitle> : null}
            <SourceNotices errors={errors} />
          </YStack>
        }
        ListEmptyComponent={
          searching && grid.isPending ? (
            <Spinner color="$accent9" self="center" mt="$6" />
          ) : (
            <SizableText size="$3" color="$color10" text="center" mt="$6">
              {searching ? 'Nothing matches that.' : 'Find a film, a series or anime across your library.'}
            </SizableText>
          )
        }
        onEndReached={() => {
          if (grid.hasNextPage && !grid.isFetchingNextPage) void grid.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        renderItem={({ item, index }) => (
          <YStack pb={GAP} pr={index % columns === columns - 1 ? 0 : GAP}>
            <PosterCard item={item} width={cardWidth} showWatch={watching.has(item.key.connectionId)} href={titleHref(item)} words={false} preferred={isTV && index === 0} />
          </YStack>
        )}
      />
    </YStack>
  );
}
