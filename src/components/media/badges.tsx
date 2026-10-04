import type { MediaItem, MediaRatings } from '@loge/api';
import { Award } from '@tamagui/lucide-icons-2/icons/Award';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { Star } from '@tamagui/lucide-icons-2/icons/Star';
import { Circle, SizableText, Theme, XStack, YStack } from 'tamagui';

import { px } from '@/components/density';
import { formatCommunityRating } from '@/components/labels';

// Over artwork of any colour, a dark translucent pill stays legible — in a
// light theme too, so what sits on it is drawn in the dark one.
export const PILL = 'rgba(0, 0, 0, 0.72)';

/** The source's ratings, stacked top to bottom: the audience's, then the critics'. */
export function RatingBadges({ ratings }: { ratings: MediaRatings }) {
  if (ratings.community === undefined && ratings.critic === undefined) return null;
  return (
    <Theme name="dark">
      <YStack position="absolute" t="$1.5" l="$1.5" gap="$1" items="flex-start">
        {ratings.community === undefined ? null : (
          <XStack bg={PILL} rounded="$10" px="$1.5" py="$0.5" gap="$1" items="center" aria-label={`Rated ${ratings.community} out of 10`}>
            <Star size={11} color="$yellow10" fill="currentColor" />
            <SizableText size="$1" fontWeight="700" color="white">
              {formatCommunityRating(ratings.community)}
            </SizableText>
          </XStack>
        )}
        {ratings.critic === undefined ? null : (
          <XStack bg={PILL} rounded="$10" px="$1.5" py="$0.5" gap="$1" items="center" aria-label={`Critics: ${ratings.critic} percent`}>
            <Award size={11} color="$orange10" />
            <SizableText size="$1" fontWeight="700" color="white">
              {`${ratings.critic}%`}
            </SizableText>
          </XStack>
        )}
      </YStack>
    </Theme>
  );
}

export function WatchedBadge() {
  return (
    <Theme name="dark">
      <Circle position="absolute" t="$1.5" r="$1.5" size={22} bg="$green9" aria-label="Watched">
        <Check size={14} color="white" strokeWidth={3} />
      </Circle>
    </Theme>
  );
}

/** How much is watched: minutes for a film or an episode, episodes for a series. */
export function ProgressBar({ value }: { value: number }) {
  return (
    <Theme name="dark">
      <YStack position="absolute" l="$1.5" r="$1.5" b="$1.5" height={4} rounded={2} bg={PILL} overflow="hidden">
        <YStack height="100%" width={`${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`} bg="$accent9" />
      </YStack>
    </Theme>
  );
}

/**
 * A fact in a box, as a title's line of facts sets them apart: its age rating
 * filled, how it looks — "4K", "HDR", "Atmos" — outlined.
 */
export function BoxBadge({ label, filled = false }: { label: string; filled?: boolean }) {
  return (
    <XStack
      px={px(4)}
      py={px(1)}
      rounded="$1"
      borderWidth={1}
      borderColor={filled ? '$color4' : '$color8'}
      bg={filled ? '$color4' : 'transparent'}
      items="center"
    >
      <SizableText size="$1" fontWeight="700" color="$color11">
        {label}
      </SizableText>
    </XStack>
  );
}

/** A bar only while something is partly watched: nothing at 0 %, the badge at 100 %. */
export function progressOf(item: MediaItem): number | undefined {
  const { watch } = item;
  if (!watch || watch.played) return undefined;
  const value = watch.progress ?? (watch.positionMs !== undefined && item.runtimeMs ? watch.positionMs / item.runtimeMs : undefined);
  return value !== undefined && value > 0 && value < 1 ? value : undefined;
}
