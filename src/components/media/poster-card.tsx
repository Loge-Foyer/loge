import type { MediaItem } from '@sc/api';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { SizableText, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';

import { progressOf, ProgressBar, RatingBadges, WatchedBadge } from './badges';
import { itemHref } from './item-link';

/**
 * A portrait card: the poster with the source's ratings top left, a check top
 * right once watched, and a bar while partly watched. `showWatch` is false for
 * a source that does not report watch status to this profile.
 */
export function PosterCard({ item, width, showWatch }: { item: MediaItem; width: number; showWatch: boolean }) {
  const progress = showWatch ? progressOf(item) : undefined;
  return (
    <Link href={itemHref(item)} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={item.year ? `${item.title}, ${item.year}` : item.title}>
        {({ pressed }) => (
          <YStack width={width} gap="$1.5" opacity={pressed ? 0.8 : 1}>
            <YStack position="relative">
              <Artwork connectionId={item.key.connectionId} image={item.images.poster} width={width} aspect={2 / 3} label={item.title} />
              <RatingBadges ratings={item.ratings} />
              {showWatch && item.watch?.played ? <WatchedBadge /> : null}
              {progress === undefined ? null : <ProgressBar value={progress} />}
            </YStack>
            <YStack gap="$0.5">
              <SizableText size="$3" color="$color12" numberOfLines={1}>
                {item.title}
              </SizableText>
              <SizableText size="$2" color="$color10" numberOfLines={1}>
                {item.year ?? ' '}
              </SizableText>
            </YStack>
          </YStack>
        )}
      </Pressable>
    </Link>
  );
}
