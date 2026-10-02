import type { MediaItem } from '@sc/api';
import { ListVideo } from '@tamagui/lucide-icons-2/icons/ListVideo';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { SizableText, XStack, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { episodeCode, timeLeft, videoCountLabel } from '@/components/labels';
import { CARD_FOCUSED, useRemoteFocus } from '@/components/remote';

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
  onFocusItem,
  preferred = false,
}: {
  item: MediaItem;
  width: number;
  showWatch: boolean;
  resumes?: boolean;
  /** On a TV: the remote is on it now. */
  onFocusItem?: (item: MediaItem) => void;
  /** On a TV: where the focus starts. */
  preferred?: boolean;
}) {
  const title = item.type === 'episode' ? item.showTitle || item.title : item.title;
  const subtitle =
    item.type === 'episode'
      ? [episodeCode(item), item.title].filter(Boolean).join(' · ')
      : item.type === 'playlist'
        ? (item.owner?.name ?? '')
        : (timeLeft(item) ?? (item.year === undefined ? '' : String(item.year)));

  const card = { item, width, title, subtitle, showWatch, preferred, onFocus: () => onFocusItem?.(item) };
  return resumes ? <SplitCard {...card} /> : <WholeCard {...card} />;
}

/** One link: the page. */
function WholeCard({ item, width, title, subtitle, showWatch, preferred, onFocus }: CardProps) {
  const { focused, handlers } = useRemoteFocus(onFocus);
  return (
    <Link href={itemHref(item)} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${subtitle}`} hasTVPreferredFocus={preferred} {...handlers}>
        {({ pressed }) => (
          <YStack width={width} gap="$1.5" opacity={pressed ? 0.8 : 1}>
            <Picture item={item} width={width} title={title} showWatch={showWatch} focused={focused} />
            <Words item={item} title={title} subtitle={subtitle} focused={focused} />
          </YStack>
        )}
      </Pressable>
    </Link>
  );
}

/** Two links: the picture plays it from where it stopped, the words open its page. */
function SplitCard({ item, width, title, subtitle, showWatch, preferred, onFocus }: CardProps) {
  const picture = useRemoteFocus(onFocus);
  const words = useRemoteFocus(onFocus);

  const position = item.watch && !item.watch.played ? item.watch.positionMs : undefined;
  const startMs = position !== undefined && position > 0 ? position : undefined;
  return (
    <YStack width={width} gap="$1.5">
      <Link href={playHref(item.key, startMs ? { startMs } : {})} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${startMs ? 'Resume' : 'Play'} ${title}, ${subtitle}`}
          hasTVPreferredFocus={preferred}
          {...picture.handlers}
        >
          {({ pressed }) => (
            <YStack opacity={pressed ? 0.8 : 1}>
              <Picture item={item} width={width} title={title} showWatch={showWatch} focused={picture.focused} plays />
            </YStack>
          )}
        </Pressable>
      </Link>
      <Link href={itemHref(item)} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${subtitle}`} hitSlop={{ top: 4, bottom: 8 }} {...words.handlers}>
          {({ pressed }) => (
            <YStack opacity={pressed ? 0.8 : 1}>
              <Words item={item} title={title} subtitle={subtitle} focused={words.focused} />
            </YStack>
          )}
        </Pressable>
      </Link>
    </YStack>
  );
}

interface CardProps {
  readonly item: MediaItem;
  readonly width: number;
  readonly title: string;
  readonly subtitle: string;
  readonly showWatch: boolean;
  readonly preferred: boolean;
  readonly onFocus: () => void;
}

function Picture({
  item,
  width,
  title,
  showWatch,
  focused,
  plays = false,
}: {
  item: MediaItem;
  width: number;
  title: string;
  showWatch: boolean;
  focused: boolean;
  plays?: boolean;
}) {
  const progress = showWatch ? progressOf(item) : undefined;
  const image = item.images.frame ?? item.images.thumb ?? item.images.backdrop ?? item.images.poster;
  return (
    <YStack position="relative" {...(focused ? CARD_FOCUSED : {})}>
      <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={16 / 9} label={title} />
      {plays ? (
        // Says what a press on the picture does, which is not what it did before.
        <YStack position="absolute" t={0} l={0} r={0} b={0} items="center" justify="center" pointerEvents="none">
          <YStack width={44} height={44} rounded={999} bg="rgba(0,0,0,0.55)" items="center" justify="center">
            <Play size={20} color="white" fill="white" />
          </YStack>
        </YStack>
      ) : null}
      {item.type === 'playlist' && item.videoCount !== undefined ? (
        // A playlist says how much is in it, where a video would say how long it is.
        <XStack position="absolute" r="$1.5" b="$1.5" gap="$1" items="center" px="$1.5" py="$0.5" rounded="$2" bg="rgba(7, 9, 10, 0.72)">
          <ListVideo size={12} color="white" />
          <SizableText size="$1" fontWeight="700" color="white">
            {videoCountLabel(item.videoCount)}
          </SizableText>
        </XStack>
      ) : null}
      {showWatch && item.watch?.played ? <WatchedBadge /> : null}
      {progress === undefined ? null : <ProgressBar value={progress} />}
    </YStack>
  );
}

function Words({ item, title, subtitle, focused }: { item: MediaItem; title: string; subtitle: string; focused: boolean }) {
  const left = item.type === 'episode' ? timeLeft(item) : undefined;
  return (
    <YStack gap="$0.5">
      <SizableText size="$3" color={focused ? '$accent11' : '$color12'} numberOfLines={1}>
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
