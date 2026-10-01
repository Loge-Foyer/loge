import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { H3, XStack, YStack, useMedia } from 'tamagui';

import { px } from './density';

/**
 * Card widths follow the viewport, so the same shelf works from phone to TV —
 * and grow on a TV with the type beneath them (`density.ts`): about seven
 * posters across 1920 points.
 */
export function usePosterWidth() {
  const media = useMedia();
  if (media.xl) return px(200);
  if (media.lg) return px(176);
  if (media.md) return px(150);
  return px(120);
}

/** The width of a landscape card, for continuing and for rows shown as scenes. */
export function useLandscapeWidth() {
  const media = useMedia();
  if (media.xl) return px(380);
  if (media.lg) return px(340);
  if (media.md) return px(300);
  return px(260);
}

export function Shelf({ title, children }: { title: string; children: ReactNode }) {
  return (
    <YStack gap="$3">
      <H3 size="$6" color="$color12">
        {title}
      </H3>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <XStack gap="$3" pr="$4">
          {children}
        </XStack>
      </ScrollView>
    </YStack>
  );
}

function SkeletonLine({ width }: { width: number | `${number}%` }) {
  return <YStack height={10} width={width} rounded="$2" bg="$color3" />;
}

/** Stands in for a poster until real items arrive with the media contract. */
export function PosterSkeleton({ width }: { width: number }) {
  return (
    <YStack width={width} gap="$2">
      <YStack width={width} aspectRatio={2 / 3} rounded="$5" bg="$color3" borderWidth={1} borderColor="$color4" />
      <SkeletonLine width="80%" />
      <SkeletonLine width="45%" />
    </YStack>
  );
}

export function ThumbnailSkeleton() {
  return (
    <YStack gap="$2">
      <YStack width="100%" aspectRatio={16 / 9} rounded="$5" bg="$color3" borderWidth={1} borderColor="$color4" />
      <SkeletonLine width="90%" />
      <SkeletonLine width="55%" />
    </YStack>
  );
}

