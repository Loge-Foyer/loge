import type { MediaItem } from '@sc/api';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { SizableText, XStack, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { episodeCode, timeLeft } from '@/components/labels';

import { progressOf, ProgressBar, WatchedBadge } from './badges';
import { itemHref, playHref } from './item-link';

/**
 * A landscape card, for continuing: the frame where playback stopped when the
 * source has one, else the episode's own still, else the scene art.
 *
 * Where it `resumes`, the picture plays it from where it stopped and the
 * words open its page — an episode's own, not its show's. Otherwise the whole
 * card opens the page.
 */
export function LandscapeCard({
  item,
  width,
  showWatch,
  resumes = false,
}: {
  item: MediaItem;
  width: number;
  showWatch: boolean;
  resumes?: boolean;
}) {
  const title = item.type === 'episode' ? item.showTitle || item.title : item.title;
  const subtitle =
    item.type === 'episode'
      ? [episodeCode(item), item.title].filter(Boolean).join(' · ')
      : (timeLeft(item) ?? (item.year === undefined ? '' : String(item.year)));

  if (!resumes) {
    return (
      <Link href={itemHref(item)} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${subtitle}`}>
          {({ pressed }) => (
            <YStack width={width} gap="$1.5" opacity={pressed ? 0.8 : 1}>
              <Picture item={item} width={width} title={title} showWatch={showWatch} />
              <Words item={item} title={title} subtitle={subtitle} />
            </YStack>
          )}
        </Pressable>
      </Link>
    );
  }

  const position = item.watch && !item.watch.played ? item.watch.positionMs : undefined;
  const startMs = position !== undefined && position > 0 ? position : undefined;
  return (
    <YStack width={width} gap="$1.5">
      <Link href={playHref(item.key, startMs ? { startMs } : {})} asChild>
        <Pressable accessibilityRole="button" accessibilityLabel={`${startMs ? 'Resume' : 'Play'} ${title}, ${subtitle}`}>
          {({ pressed }) => (
            <YStack opacity={pressed ? 0.8 : 1}>
              <Picture item={item} width={width} title={title} showWatch={showWatch} plays />
            </YStack>
          )}
        </Pressable>
      </Link>
      <Link href={itemHref(item)} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${subtitle}`} hitSlop={{ top: 4, bottom: 8 }}>
          {({ pressed }) => (
            <YStack opacity={pressed ? 0.8 : 1}>
              <Words item={item} title={title} subtitle={subtitle} />
            </YStack>
          )}
        </Pressable>
      </Link>
    </YStack>
  );
}

function Picture({ item, width, title, showWatch, plays = false }: { item: MediaItem; width: number; title: string; showWatch: boolean; plays?: boolean }) {
  const progress = showWatch ? progressOf(item) : undefined;
  const image = item.images.frame ?? item.images.thumb ?? item.images.backdrop ?? item.images.poster;
  return (
    <YStack position="relative">
      <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={16 / 9} label={title} />
      {plays ? (
        // Says what a press on the picture does, which is not what it did before.
        <YStack position="absolute" t={0} l={0} r={0} b={0} items="center" justify="center" pointerEvents="none">
          <YStack width={44} height={44} rounded={999} bg="rgba(0,0,0,0.55)" items="center" justify="center">
            <Play size={20} color="white" fill="white" />
          </YStack>
        </YStack>
      ) : null}
      {showWatch && item.watch?.played ? <WatchedBadge /> : null}
      {progress === undefined ? null : <ProgressBar value={progress} />}
    </YStack>
  );
}

function Words({ item, title, subtitle }: { item: MediaItem; title: string; subtitle: string }) {
  const left = item.type === 'episode' ? timeLeft(item) : undefined;
  return (
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
  );
}
