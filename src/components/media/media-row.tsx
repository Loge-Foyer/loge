import type { MediaItem } from '@sc/api';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { FlatList, Pressable } from 'react-native';
import { H3, XStack, YStack } from 'tamagui';

import { PosterSkeleton, ThumbnailSkeleton } from '@/components/shelf';
import type { CardStyle } from '@/services/home-layout';
import type { SourceError } from '@/services/media';

import { LandscapeCard } from './landscape-card';
import { PosterCard } from './poster-card';
import { SourceNotices } from './source-notices';

const GAP = 12;
const SKELETONS = [0, 1, 2, 3, 4, 5];

/**
 * A titled, horizontally scrolling row of cards. Its title opens the whole
 * list when there is one to open.
 */
export function MediaRow({
  title,
  href,
  items,
  loading,
  sourceErrors,
  card,
  width,
  watchFrom,
  onRetry,
}: {
  title: string;
  href?: Href;
  items: readonly MediaItem[];
  loading: boolean;
  sourceErrors: readonly SourceError[];
  card: CardStyle;
  /** Card width, from the viewport. */
  width: number;
  /** Whether an item's source reports watch status to this profile. */
  watchFrom: (item: MediaItem) => boolean;
  onRetry?: () => void;
}) {
  const heading: ReactNode = (
    <XStack items="center" gap="$1">
      <H3 size="$6" color="$color12">
        {title}
      </H3>
      {href ? <ChevronRight size={20} color="$color10" /> : null}
    </XStack>
  );
  return (
    <YStack gap="$3">
      <XStack px="$4">
        {href ? (
          <Link href={href} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`${title}, show all`} hitSlop={8}>
              {heading}
            </Pressable>
          </Link>
        ) : (
          heading
        )}
      </XStack>
      {loading ? (
        <XStack gap={GAP} px="$4" overflow="hidden">
          {SKELETONS.map((index) =>
            card === 'poster' ? <PosterSkeleton key={index} width={width} /> : (
              <YStack key={index} width={width}>
                <ThumbnailSkeleton />
              </YStack>
            ),
          )}
        </XStack>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(item) => `${item.key.connectionId}:${item.key.externalId}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: GAP }}
          getItemLayout={(_data, index) => ({ length: width + GAP, offset: (width + GAP) * index, index })}
          renderItem={({ item }) =>
            card === 'poster' ? (
              <PosterCard item={item} width={width} showWatch={watchFrom(item)} />
            ) : (
              <LandscapeCard item={item} width={width} showWatch={watchFrom(item)} />
            )
          }
        />
      )}
      <YStack px="$4">
        <SourceNotices errors={sourceErrors} {...(onRetry ? { onRetry } : {})} />
      </YStack>
    </YStack>
  );
}
