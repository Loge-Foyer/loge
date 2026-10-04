import type { MediaItem } from '@loge/api';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { FlatList, Pressable } from 'react-native';
import { H3, XStack, YStack } from 'tamagui';

import { GUTTER, px } from '@/components/density';
import { LandscapeCard } from '@/components/media/landscape-card';
import { PosterCard } from '@/components/media/poster-card';
import { SourceNotices } from '@/components/media/source-notices';
import { cardFocusRoom, useRemoteFocus } from '@/components/remote';
import { PosterSkeleton, ThumbnailSkeleton } from '@/components/shelf';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import type { CardStyle } from '@/services/home-layout';
import type { SourceError } from '@/services/media';

const GAP = px(12);
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
  resumesFrom,
  onFocusItem,
  preferFirst = false,
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
  /** Whether a landscape card's picture plays the item from where it stopped. */
  resumesFrom?: (item: MediaItem) => boolean;
  /** On a TV: the card the remote is on now. */
  onFocusItem?: (item: MediaItem) => void;
  /** On a TV: the focus starts on this row's first card. */
  preferFirst?: boolean;
  onRetry?: () => void;
}) {
  const { focused, handlers } = useRemoteFocus();
  const withKept = useKeptWatch(items);
  const room = cardFocusRoom(card === 'poster' ? width * 1.5 : (width * 9) / 16);
  const heading: ReactNode = (
    <XStack items="center" gap="$1">
      <H3 size="$6" color={focused ? '$accent11' : '$color12'}>
        {title}
      </H3>
      {href ? <ChevronRight size={20} color={focused ? '$accent11' : '$color10'} /> : null}
    </XStack>
  );
  return (
    <YStack gap="$3">
      <XStack px={GUTTER}>
        {href ? (
          <Link href={href} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`${title}, show all`} hitSlop={8} {...handlers}>
              {heading}
            </Pressable>
          </Link>
        ) : (
          heading
        )}
      </XStack>
      {loading ? (
        <XStack gap={GAP} px={GUTTER} overflow="hidden">
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
          // Room above for a focused card, which a scroll view would cut off, taken back from the gap above it.
          style={room > 0 ? { marginTop: -room } : undefined}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: room, gap: GAP }}
          getItemLayout={(_data, index) => ({ length: width + GAP, offset: (width + GAP) * index, index })}
          renderItem={({ item, index }) => {
            const focus = { ...(onFocusItem ? { onFocusItem } : {}), preferred: preferFirst && index === 0 };
            return card === 'poster' ? (
              <PosterCard item={withKept(item)} width={width} showWatch={watchFrom(item)} {...focus} />
            ) : (
              <LandscapeCard item={withKept(item)} width={width} showWatch={watchFrom(item)} resumes={resumesFrom?.(item) ?? false} {...focus} />
            );
          }}
        />
      )}
      <YStack px={GUTTER}>
        <SourceNotices errors={sourceErrors} {...(onRetry ? { onRetry } : {})} />
      </YStack>
    </YStack>
  );
}
