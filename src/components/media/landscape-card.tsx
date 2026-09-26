import type { MediaItem } from '@sc/api';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { SizableText, XStack, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { episodeCode, timeLeft } from '@/components/labels';

import { progressOf, ProgressBar, WatchedBadge } from './badges';
import { itemHref } from './item-link';

/**
 * A landscape card, for continuing: the frame where playback stopped when the
 * source has one, else the episode's own still, else the scene art.
 */
export function LandscapeCard({ item, width, showWatch }: { item: MediaItem; width: number; showWatch: boolean }) {
  const progress = showWatch ? progressOf(item) : undefined;
  const image = item.images.frame ?? item.images.thumb ?? item.images.backdrop ?? item.images.poster;
  const title = item.type === 'episode' ? item.showTitle || item.title : item.title;
  const subtitle =
    item.type === 'episode'
      ? [episodeCode(item), item.title].filter(Boolean).join(' · ')
      : (timeLeft(item) ?? (item.year === undefined ? '' : String(item.year)));
  const left = item.type === 'episode' ? timeLeft(item) : undefined;
  return (
    <Link href={itemHref(item)} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${subtitle}`}>
        {({ pressed }) => (
          <YStack width={width} gap="$1.5" opacity={pressed ? 0.8 : 1}>
            <YStack position="relative">
              <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={16 / 9} label={title} />
              {showWatch && item.watch?.played ? <WatchedBadge /> : null}
              {progress === undefined ? null : <ProgressBar value={progress} />}
            </YStack>
            <YStack gap="$0.5">
              <SizableText size="$3" color="$color12" numberOfLines={1}>
                {title}
              </SizableText>
              <XStack gap="$2">
                <SizableText size="$2" color="$color10" numberOfLines={1} flex={1}>
                  {subtitle}
                </SizableText>
                {left ? (
                  <SizableText size="$2" color="$color9">
                    {left}
                  </SizableText>
                ) : null}
              </XStack>
            </YStack>
          </YStack>
        )}
      </Pressable>
    </Link>
  );
}
