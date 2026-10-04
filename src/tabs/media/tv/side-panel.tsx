import type { Episode, MediaItem, Show } from '@loge/api';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';
import { FocusGroup } from '@/components/focus-group';
import { progressOf, ProgressBar, WatchedBadge } from '@/components/media/badges';
import { titleHref } from '@/components/media/item-link';
import { PosterCard } from '@/components/media/poster-card';
import { RowTitle } from '@/components/media/row-title';
import { CARD_RING, useRemoteFocus } from '@/components/remote';
import { CHOSEN } from '@/components/settings-list';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useChildren, useMoreLikeThis } from '@/hooks/use-media';

import { episodeLength, seasonToOpen, upNextOf } from '../shared/title-meta';

const SLIDE_MS = 220;
const isEpisode = (item: MediaItem): item is Episode => item.type === 'episode';

/**
 * What slides in from the right over a title's page — its episodes, or titles
 * like it — about half the screen, on a dark veil. Up, down and right keep the
 * remote in it; left goes back to the page's buttons, and Back closes it.
 */
export function SidePanel({ title, reduceMotion, children }: { title: string; reduceMotion: boolean; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const panelWidth = Math.round(width * 0.46);
  const [offset] = useState(() => new Animated.Value(reduceMotion ? 0 : panelWidth));
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(offset, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }).start();
  }, [offset, reduceMotion]);
  return (
    <Animated.View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: panelWidth, transform: [{ translateX: offset }] }}>
      <YStack position="absolute" t={0} l={0} r={0} b={0} bg="$background" opacity={0.94} />
      <FocusGroup traps={['up', 'down', 'right']} style={{ flex: 1 }}>
        <YStack flex={1} pt={px(56)} pl={px(40)} pr={GUTTER} gap="$4">
          <RowTitle>{title}</RowTitle>
          {children}
        </YStack>
      </FocusGroup>
    </Animated.View>
  );
}

/**
 * A series' episodes: its seasons along the top, then each episode — its
 * still, its number and name, how long it runs, what it is about. Select plays
 * it, from where it stopped; the remote starts on the one to watch next.
 */
export function EpisodesPanel({
  show,
  initial,
  showWatch,
  canPlay,
  onPlay,
}: {
  show: Show;
  initial: string | undefined;
  showWatch: boolean;
  canPlay: boolean;
  onPlay: (episode: Episode) => void;
}) {
  const seasons = useChildren(show);
  const list = seasons.data?.items ?? [];
  const [chosen, setChosen] = useState(initial);
  const season = seasonToOpen(list, chosen);
  const episodes = useChildren(season);
  const withKept = useKeptWatch(episodes.data?.items ?? []);
  const shown = (episodes.data?.items ?? []).map(withKept).filter(isEpisode);
  const next = upNextOf(shown);
  if (seasons.isPending) return <Spinner color="$accent9" self="flex-start" />;
  return (
    <YStack flex={1} gap="$4">
      {list.length > 1 ? (
        <FocusGroup>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: px(12), paddingVertical: px(6) }}>
            {list.map((each) => {
              const on = each.key.externalId === season?.key.externalId;
              return (
                <Button
                  key={each.key.externalId}
                  size="$4"
                  rounded="$10"
                  borderWidth={0}
                  bg={on ? CHOSEN.bg : '$color3'}
                  color={on ? CHOSEN.color : '$color12'}
                  onPress={() => setChosen(each.key.externalId)}
                >
                  {each.title}
                </Button>
              );
            })}
          </ScrollView>
        </FocusGroup>
      ) : null}
      {episodes.isPending ? <Spinner color="$accent9" self="flex-start" /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: px(8), paddingBottom: px(64) }}>
        {shown.map((episode) => (
          <EpisodeRow
            key={episode.key.externalId}
            episode={episode}
            showWatch={showWatch}
            preferred={episode.key.externalId === next?.key.externalId}
            onPress={canPlay ? () => onPlay(episode) : undefined}
          />
        ))}
      </ScrollView>
    </YStack>
  );
}

function EpisodeRow({ episode, showWatch, preferred, onPress }: { episode: Episode; showWatch: boolean; preferred: boolean; onPress: (() => void) | undefined }) {
  const { focused, handlers } = useRemoteFocus();
  const progress = showWatch ? progressOf(episode) : undefined;
  const length = episodeLength(episode);
  const name = episode.episodeNumber === undefined ? episode.title : `${episode.episodeNumber}. ${episode.title}`;
  return (
    <Pressable onPress={onPress} hasTVPreferredFocus={preferred} accessibilityRole="button" accessibilityLabel={name} {...handlers}>
      <XStack gap="$4" p="$3" rounded="$6" bg={focused ? '$color4' : 'transparent'}>
        <YStack position="relative" rounded="$4" {...(focused ? CARD_RING : {})}>
          <Artwork connectionId={episode.key.connectionId} image={episode.images.thumb ?? episode.images.backdrop} width={px(220)} aspect={16 / 9} label={episode.title} rounded="$4" />
          {showWatch && episode.watch?.played ? <WatchedBadge /> : null}
          {progress === undefined ? null : <ProgressBar value={progress} />}
        </YStack>
        <YStack flex={1} gap="$1.5">
          <SizableText size="$5" fontWeight="600" color="$color12" numberOfLines={1}>
            {name}
          </SizableText>
          {length ? (
            <SizableText size="$3" color="$color10">
              {length}
            </SizableText>
          ) : null}
          {episode.overview ? (
            <Paragraph size="$3" color="$color11" numberOfLines={2}>
              {episode.overview}
            </Paragraph>
          ) : null}
        </YStack>
      </XStack>
    </Pressable>
  );
}

/** Titles like this one, as posters; select opens one's own page over this. */
export function SimilarPanel({ item, showWatch }: { item: MediaItem; showWatch: boolean }) {
  const like = useMoreLikeThis(item);
  const { width } = useWindowDimensions();
  const items = like.data?.items ?? [];
  const gap = px(16);
  const cardWidth = Math.floor((Math.round(width * 0.46) - px(40) - GUTTER - 2 * gap) / 3);
  if (like.isPending) return <Spinner color="$accent9" self="flex-start" />;
  if (items.length === 0) {
    return (
      <SizableText size="$4" color="$color10">
        {item.genres.length === 0 ? 'This title names no genre to find others by.' : 'Nothing else here is like it yet.'}
      </SizableText>
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap, paddingVertical: px(12), paddingBottom: px(64) }}>
      {items.map((other, index) => (
        <PosterCard
          key={`${other.key.connectionId}|${other.key.externalId}`}
          item={other}
          width={cardWidth}
          showWatch={showWatch}
          href={titleHref(other)}
          words={false}
          preferred={index === 0}
        />
      ))}
    </ScrollView>
  );
}
