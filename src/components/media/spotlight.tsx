import type { MediaItem } from '@sc/api';
import { useWindowDimensions } from 'react-native';
import { H1, Paragraph, SizableText, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { episodeCode, formatCommunityRating, formatRuntime } from '@/components/labels';
import { GUTTER } from '@/components/density';
import { Scrim } from '@/components/scrim';

/**
 * A TV's home, above its rows: whatever card the remote is on, large — its
 * picture, its title, a line of what it is and two of what it is about. It
 * follows the focus across Continue Watching and every row, which is how a
 * screen read from the sofa says what is selected without anyone squinting
 * at a poster.
 */
export function Spotlight({ item }: { item: MediaItem | undefined }) {
  const { width, height: screen } = useWindowDimensions();
  // Enough to see what it is, and room left for a row of cards beneath it.
  const height = Math.round(screen * 0.5);
  if (!item) return <YStack width={width} height={height} />;
  const image = item.images.backdrop ?? item.images.thumb ?? item.images.frame ?? item.images.poster;
  const facts = [
    item.type === 'episode' ? [item.showTitle, episodeCode(item)].filter(Boolean).join(' · ') : undefined,
    item.year === undefined ? undefined : String(item.year),
    item.runtimeMs ? formatRuntime(item.runtimeMs) : undefined,
    item.ratings.community === undefined ? undefined : `★ ${formatCommunityRating(item.ratings.community)}`,
    item.genres.slice(0, 3).join(', ') || undefined,
  ].filter((fact): fact is string => fact !== undefined && fact !== '');
  return (
    <YStack position="relative" width={width} height={height}>
      <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={width / height} label={item.title} rounded="$0" />
      <Scrim from="top" strength={0.4} />
      <Scrim from="bottom" />
      <YStack position="absolute" l={GUTTER} b="$5" maxW={width * 0.5} gap="$2">
        <H1 size="$10" color="$color12" numberOfLines={2}>
          {item.title}
        </H1>
        {facts.length > 0 ? (
          <SizableText size="$4" color="$color11" numberOfLines={1}>
            {facts.join('  ·  ')}
          </SizableText>
        ) : null}
        {item.overview ? (
          <Paragraph size="$4" color="$color11" numberOfLines={2}>
            {item.overview}
          </Paragraph>
        ) : null}
      </YStack>
    </YStack>
  );
}
