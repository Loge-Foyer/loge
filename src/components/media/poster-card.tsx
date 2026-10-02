import type { MediaItem } from '@sc/api';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { SizableText, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { CARD_FOCUSED, useRemoteFocus } from '@/components/remote';

import { progressOf, ProgressBar, RatingBadges, WatchedBadge } from './badges';
import { itemHref } from './item-link';

/**
 * A portrait card: the poster with the source's ratings top left, a check top
 * right once watched, and a bar while partly watched. `showWatch` is false for
 * a source that does not report watch status to this profile.
 */
export function PosterCard({
  item,
  width,
  showWatch,
  onFocusItem,
  preferred = false,
  caption,
}: {
  item: MediaItem;
  width: number;
  showWatch: boolean;
  /** In place of the year: where a series someone is watching got to — "S2 · E5". */
  caption?: string;
  /** On a TV: the remote is on it now. */
  onFocusItem?: (item: MediaItem) => void;
  /** On a TV: where the focus starts. */
  preferred?: boolean;
}) {
  const progress = showWatch ? progressOf(item) : undefined;
  const { focused, handlers } = useRemoteFocus(() => onFocusItem?.(item));
  return (
    <Link href={itemHref(item)} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={item.year ? `${item.title}, ${item.year}` : item.title}
        hasTVPreferredFocus={preferred}
        {...handlers}
      >
        {({ pressed }) => (
          <YStack width={width} gap="$1.5" opacity={pressed ? 0.8 : 1}>
            <YStack position="relative" {...(focused ? CARD_FOCUSED : {})}>
              <Artwork connectionId={item.key.connectionId} image={item.images.poster} width={width} aspect={2 / 3} label={item.title} />
              <RatingBadges ratings={item.ratings} />
              {showWatch && item.watch?.played ? <WatchedBadge /> : null}
              {progress === undefined ? null : <ProgressBar value={progress} />}
            </YStack>
            <YStack gap="$0.5">
              <SizableText size="$3" color={focused ? '$accent11' : '$color12'} numberOfLines={1}>
                {item.title}
              </SizableText>
              <SizableText size="$2" color={caption ? '$accent11' : '$color10'} numberOfLines={1}>
                {caption ?? item.year ?? ' '}
              </SizableText>
            </YStack>
          </YStack>
        )}
      </Pressable>
    </Link>
  );
}
