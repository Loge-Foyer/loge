import type { ConnectionId, Episode, MediaDetail, MediaItem, Person, Show } from '@sc/api';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { H1, H3, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Artwork, ArtworkLogo } from '@/components/artwork';
import { Chip, ChipRow } from '@/components/chip';
import { episodeCode, formatCommunityRating, formatRuntime, timeLeft } from '@/components/labels';
import { progressOf, ProgressBar, WatchedBadge } from '@/components/media/badges';
import { itemHref } from '@/components/media/item-link';
import { Scrim } from '@/components/scrim';
import { Screen } from '@/components/screen';
import { SourceTabs } from '@/components/source-tabs';
import { useChildren, useItem } from '@/hooks/use-media';
import { useTabSources } from '@/hooks/use-sources';

/** A film, a series with its seasons and episodes, or one episode — whatever the key points at. */
export function DetailScreen({ connectionId, itemId, season }: { connectionId: ConnectionId; itemId: string; season?: string }) {
  const detail = useItem({ connectionId, externalId: itemId });
  const { data: sources = [] } = useTabSources('media');
  const showWatch = sources.some(
    (source) => source.connection.id === connectionId && (source.effective.media?.capabilities.has('watchStateRead') ?? false),
  );

  if (detail.isPending) {
    return (
      <YStack flex={1} items="center" justify="center" bg="$background">
        <Spinner size="large" color="$accent9" />
      </YStack>
    );
  }
  if (detail.error) {
    return (
      <Screen>
        <YStack pt="$10">
          <SizableText color="$color10">{detail.error.message}</SizableText>
        </YStack>
      </Screen>
    );
  }
  return <Detail detail={detail.data} showWatch={showWatch} {...(season ? { season } : {})} />;
}

function Detail({ detail, showWatch, season }: { detail: MediaDetail; showWatch: boolean; season?: string }) {
  const { item, people, studios, tagline } = detail;
  return (
    <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="never">
      <Hero item={item} />
      <YStack px="$4" pt="$3" pb="$12" gap="$5" width="100%" maxW={1100} self="center">
        <Meta item={item} />
        {showWatch ? <WatchState item={item} /> : null}
        {tagline ? (
          <SizableText size="$5" color="$color11" fontStyle="italic">
            {tagline}
          </SizableText>
        ) : null}
        {item.overview ? (
          <Paragraph size="$4" color="$color11" maxW={760}>
            {item.overview}
          </Paragraph>
        ) : null}
        {item.type === 'episode' ? <ShowLink episode={item} /> : null}
        {item.type === 'show' ? <Seasons show={item} showWatch={showWatch} {...(season ? { initial: season } : {})} /> : null}
        {people.length > 0 ? <People people={people} connectionId={item.key.connectionId} /> : null}
        {studios.length > 0 ? (
          <SizableText size="$2" color="$color9">
            {studios.join(' · ')}
          </SizableText>
        ) : null}
      </YStack>
    </ScrollView>
  );
}

function Hero({ item }: { item: MediaItem }) {
  const { width } = useWindowDimensions();
  const aspect = width >= 900 ? 21 / 9 : 16 / 10;
  const image =
    item.type === 'episode'
      ? (item.images.thumb ?? item.images.backdrop)
      : (item.images.backdrop ?? item.images.thumb ?? item.images.poster);
  const title = item.title;
  return (
    <YStack position="relative" width={width} height={Math.round(width / aspect)} bg="$color2">
      <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={aspect} label={item.title} rounded="$0" />
      <Scrim from="top" strength={0.35} />
      <Scrim from="bottom" />
      <YStack position="absolute" l="$4" r="$4" b="$4" gap="$2" maxW={680}>
        {item.type === 'episode' ? (
          <SizableText size="$3" fontWeight="600" color="$color11">
            {[item.showTitle, episodeCode(item)].filter(Boolean).join(' · ')}
          </SizableText>
        ) : null}
        <ArtworkLogo
          connectionId={item.key.connectionId}
          image={item.type === 'episode' ? undefined : item.images.logo}
          width={Math.min(360, width * 0.6)}
          height={Math.min(120, width * 0.2)}
          label={title}
          fallback={
            <H1 size="$10" color="$color12" numberOfLines={2}>
              {title}
            </H1>
          }
        />
      </YStack>
    </YStack>
  );
}

function Meta({ item }: { item: MediaItem }) {
  const facts = [
    item.year === undefined ? undefined : item.type === 'show' && item.endYear && item.endYear !== item.year ? `${item.year}–${item.endYear}` : String(item.year),
    item.runtimeMs ? formatRuntime(item.runtimeMs) : undefined,
    item.type === 'show' && item.seasonCount ? `${item.seasonCount} ${item.seasonCount === 1 ? 'season' : 'seasons'}` : undefined,
    item.contentRating,
    item.ratings.community === undefined ? undefined : `★ ${formatCommunityRating(item.ratings.community)}`,
    item.ratings.critic === undefined ? undefined : `${item.ratings.critic}% critics`,
  ].filter((fact): fact is string => fact !== undefined);
  return (
    <YStack gap="$3">
      <SizableText size="$3" color="$color11">
        {facts.join('  ·  ')}
      </SizableText>
      {item.genres.length > 0 ? (
        <ChipRow>
          {item.genres.map((genre) => (
            <Chip key={genre} label={genre} />
          ))}
        </ChipRow>
      ) : null}
    </YStack>
  );
}

function WatchState({ item }: { item: MediaItem }) {
  const progress = progressOf(item);
  if (item.watch?.played) {
    return (
      <XStack gap="$2" items="center">
        <Check size={16} color="$green10" />
        <SizableText size="$3" color="$green10">
          Watched
        </SizableText>
      </XStack>
    );
  }
  if (progress === undefined) return null;
  const left =
    item.type === 'show' || item.type === 'season'
      ? item.watch?.unplayedCount === undefined
        ? undefined
        : `${item.watch.unplayedCount} ${item.watch.unplayedCount === 1 ? 'episode' : 'episodes'} left`
      : timeLeft(item);
  return (
    <YStack gap="$2" maxW={420}>
      <YStack height={4} rounded={2} bg="$color4" overflow="hidden">
        <YStack height="100%" width={`${Math.round(progress * 100)}%`} bg="$accent9" />
      </YStack>
      {left ? (
        <SizableText size="$2" color="$color10">
          {left}
        </SizableText>
      ) : null}
    </YStack>
  );
}

function ShowLink({ episode }: { episode: Episode }) {
  return (
    <Link href={{ pathname: '/item/[connectionId]/[itemId]', params: { connectionId: episode.show.connectionId, itemId: episode.show.externalId } }} asChild>
      <Pressable accessibilityRole="link">
        <XStack gap="$1" items="center">
          <SizableText size="$4" color="$accent11" fontWeight="600">
            {`All episodes of ${episode.showTitle}`}
          </SizableText>
          <ChevronRight size={18} color="$accent11" />
        </XStack>
      </Pressable>
    </Link>
  );
}

/** The seasons as tabs, starting with the first one that still has something unwatched. */
function Seasons({ show, initial, showWatch }: { show: Show; initial?: string; showWatch: boolean }) {
  const seasons = useChildren(show);
  const list = seasons.data ?? [];
  const [chosen, setChosen] = useState(initial);
  const unfinished = list.find((season) => season.watch !== undefined && !season.watch.played);
  const selected = list.find((season) => season.key.externalId === chosen) ?? unfinished ?? list[0];
  const episodes = useChildren(selected);

  if (seasons.isPending) return <Spinner color="$accent9" self="flex-start" />;
  if (list.length === 0) return null;
  return (
    <YStack gap="$4">
      <SourceTabs
        tabs={list.map((season) => ({ id: season.key.externalId, label: season.title }))}
        selected={selected?.key.externalId ?? ''}
        onSelect={setChosen}
      />
      {episodes.isPending ? <Spinner color="$accent9" self="flex-start" /> : null}
      <YStack gap="$4">
        {(episodes.data ?? []).map((episode) =>
          episode.type === 'episode' ? <EpisodeRow key={episode.key.externalId} episode={episode} showWatch={showWatch} /> : null,
        )}
      </YStack>
    </YStack>
  );
}

function EpisodeRow({ episode, showWatch }: { episode: Episode; showWatch: boolean }) {
  const progress = showWatch ? progressOf(episode) : undefined;
  const facts = [episode.runtimeMs ? formatRuntime(episode.runtimeMs) : undefined, episode.airDate].filter(Boolean).join(' · ');
  return (
    <Link href={itemHref(episode)} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${episodeCode(episode)} ${episode.title}`}>
        {({ pressed }) => (
          <XStack gap="$3" opacity={pressed ? 0.8 : 1}>
            <YStack position="relative">
              <Artwork
                connectionId={episode.key.connectionId}
                image={episode.images.thumb ?? episode.images.backdrop}
                width={168}
                aspect={16 / 9}
                label={episode.title}
                rounded="$4"
              />
              {showWatch && episode.watch?.played ? <WatchedBadge /> : null}
              {progress === undefined ? null : <ProgressBar value={progress} />}
            </YStack>
            <YStack flex={1} gap="$1">
              <SizableText size="$4" color="$color12" numberOfLines={2}>
                {episode.episodeNumber === undefined ? episode.title : `${episode.episodeNumber}. ${episode.title}`}
              </SizableText>
              {facts ? (
                <SizableText size="$2" color="$color10">
                  {facts}
                </SizableText>
              ) : null}
              {episode.overview ? (
                <Paragraph size="$2" color="$color10" numberOfLines={2}>
                  {episode.overview}
                </Paragraph>
              ) : null}
            </YStack>
          </XStack>
        )}
      </Pressable>
    </Link>
  );
}

function People({ people, connectionId }: { people: readonly Person[]; connectionId: ConnectionId }) {
  return (
    <YStack gap="$3">
      <H3 size="$6" color="$color12">
        Cast & crew
      </H3>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <XStack gap="$4">
          {people.slice(0, 24).map((person, index) => (
            <YStack key={`${person.name}-${index}`} width={88} gap="$1.5" items="center">
              <Artwork connectionId={connectionId} image={person.image} width={72} aspect={1} label={person.name} rounded={999} />
              <SizableText size="$2" color="$color12" text="center" numberOfLines={2}>
                {person.name}
              </SizableText>
              {person.role ? (
                <SizableText size="$1" color="$color10" text="center" numberOfLines={2}>
                  {person.role}
                </SizableText>
              ) : null}
            </YStack>
          ))}
        </XStack>
      </ScrollView>
    </YStack>
  );
}
