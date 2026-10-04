import type { MediaItem } from '@loge/api';
import { Link, type Href } from 'expo-router';
import type { Ref } from 'react';
import { Pressable, type View } from 'react-native';
import { SizableText, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { CARD_FOCUSED, cardFocusRoom, useRemoteFocus } from '@/components/remote';

import { progressOf, ProgressBar, RatingBadges, WatchedBadge } from './badges';
import { itemHref } from './item-link';

/**
 * A portrait card: the poster with the source's ratings top left, a check top
 * right once watched, and a bar while partly watched. `showWatch` is false for
 * a source that does not report watch status to this profile.
 */
export function PosterCard({
  ref,
  item,
  width,
  showWatch,
  onFocusItem,
  onBlurItem,
  preferred = false,
  caption,
  href,
  words = true,
}: {
  /** The card's own focusable frame, which `requestTVFocus()` sends the remote to. */
  ref?: Ref<View>;
  item: MediaItem;
  width: number;
  showWatch: boolean;
  /** In place of the year: where a series someone is watching got to — "S2 · E5". */
  caption?: string;
  /** On a TV: the remote is on it now, and has left it. */
  onFocusItem?: (item: MediaItem) => void;
  onBlurItem?: (item: MediaItem) => void;
  /** On a TV: where the focus starts. */
  preferred?: boolean;
  /** Where it opens, where that is not the item's ordinary page. */
  href?: Href;
  /** The title and year beneath it; a row of posters that speak for themselves goes without. */
  words?: boolean;
}) {
  const progress = showWatch ? progressOf(item) : undefined;
  const { focused, handlers } = useRemoteFocus(() => onFocusItem?.(item));
  return (
    <Link href={href ?? itemHref(item)} asChild>
      <Pressable
        {...(ref ? { ref } : {})}
        accessibilityRole="link"
        accessibilityLabel={item.year ? `${item.title}, ${item.year}` : item.title}
        hasTVPreferredFocus={preferred}
        {...handlers}
        onBlur={() => {
          handlers.onBlur();
          onBlurItem?.(item);
        }}
      >
        {({ pressed }) => (
          <YStack width={width} gap="$1.5" opacity={pressed ? 0.8 : 1}>
            <YStack position="relative" {...(focused ? CARD_FOCUSED : {})}>
              <Artwork connectionId={item.key.connectionId} image={item.images.poster} width={width} aspect={2 / 3} label={item.title} />
              <RatingBadges ratings={item.ratings} />
              {showWatch && item.watch?.played ? <WatchedBadge /> : null}
              {progress === undefined ? null : <ProgressBar value={progress} />}
            </YStack>
            {words ? (
              <YStack gap="$0.5" pt={cardFocusRoom(width * 1.5)}>
                <SizableText size="$3" color={focused ? '$accent11' : '$color12'} numberOfLines={1}>
                  {item.title}
                </SizableText>
                <SizableText size="$2" color={caption ? '$accent11' : '$color10'} numberOfLines={1}>
                  {caption ?? item.year ?? ' '}
                </SizableText>
              </YStack>
            ) : null}
          </YStack>
        )}
      </Pressable>
    </Link>
  );
}
