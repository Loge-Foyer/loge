import type { MediaItem } from '@loge/api';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Link } from 'expo-router';
import { FlatList, Pressable } from 'react-native';
import { SizableText, XStack, YStack } from 'tamagui';

import { GUTTER, px } from '@/components/density';
import { titleHref } from '@/components/media/item-link';
import { LandscapeCard } from '@/components/media/landscape-card';
import { PosterCard } from '@/components/media/poster-card';
import { RowTitle } from '@/components/media/row-title';
import { PosterSkeleton, ThumbnailSkeleton } from '@/components/shelf';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import type { HomeFilter } from '@/services/home-filter';

import { browseHref } from '../shared/links';
import type { MediaHomeRow } from '../shared/use-media-home';

const GAP = px(8);
const SKELETONS = 6;

/**
 * One of the home's rows on a phone: its title in grey capitals, opening the
 * row's grid, then its titles side by side — posters with nothing beneath, as
 * the pictures say what they are, or scenes for what is being watched, whose
 * picture plays and whose words open the title.
 */
export function MobileRow({
  row,
  filter,
  posterWidth,
  landscapeWidth,
  watchFrom,
  resumesFrom,
}: {
  row: MediaHomeRow;
  filter: HomeFilter;
  posterWidth: number;
  landscapeWidth: number;
  watchFrom: (item: MediaItem) => boolean;
  resumesFrom: (item: MediaItem) => boolean;
}) {
  const withKept = useKeptWatch(row.items);
  const kept = row.row.type === 'downloads';
  const scenes = row.row.type !== 'titles' || row.row.card === 'landscape';
  const width = scenes ? landscapeWidth : posterWidth;
  const grid = row.row.type === 'titles' ? browseHref(row.row.id, filter) : undefined;
  return (
    <YStack gap="$2">
      {grid ? (
        <Link href={grid} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={`${row.title}, all of it`} hitSlop={8}>
            <XStack px={GUTTER} gap="$1" items="center">
              <RowTitle>{row.title}</RowTitle>
              <ChevronRight size={px(14)} color="$color10" />
            </XStack>
          </Pressable>
        </Link>
      ) : (
        <YStack px={GUTTER}>
          <RowTitle>{row.title}</RowTitle>
        </YStack>
      )}
      {row.loading && row.items.length === 0 ? (
        <XStack px={GUTTER} gap={GAP}>
          {Array.from({ length: SKELETONS }, (_, index) => (scenes ? <ThumbnailSkeleton key={index} width={width} /> : <PosterSkeleton key={index} width={width} />))}
        </XStack>
      ) : row.items.length === 0 ? (
        <SizableText px={GUTTER} size="$3" color="$color10">
          Nothing here yet.
        </SizableText>
      ) : (
        <FlatList
          horizontal
          data={row.items.map(withKept)}
          keyExtractor={(item) => `${item.key.connectionId}|${item.key.externalId}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: GUTTER, gap: GAP }}
          renderItem={({ item }) =>
            scenes ? (
              <LandscapeCard
                item={item}
                width={width}
                // As it was when it was kept: its watch state is no longer news.
                showWatch={!kept && watchFrom(item)}
                resumes={row.row.type === 'continue' && resumesFrom(item)}
                href={titleHref(item)}
              />
            ) : (
              <PosterCard item={item} width={width} showWatch={watchFrom(item)} href={titleHref(item)} words={false} />
            )
          }
        />
      )}
    </YStack>
  );
}
