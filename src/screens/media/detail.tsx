import type { ConnectionId, Creator, Episode, ImageRef, MediaCapability, MediaDetail, MediaItem, MediaVersion, Person, PluginId, Show } from '@loge/api';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Ellipsis } from '@tamagui/lucide-icons-2/icons/Ellipsis';
import { Eye } from '@tamagui/lucide-icons-2/icons/Eye';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { useMutation } from '@tanstack/react-query';
import { Link, router, Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { H1, H3, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { ActionButton } from '@/components/action-button';
import { px } from '@/components/density';
import { Artwork, ArtworkLogo } from '@/components/artwork';
import { EyeFilled } from '@/components/icons';
import { MoreButton } from '@/components/more-menu';
import { CARD_FOCUSED, isTV, useRemoteFocus } from '@/components/remote';
import { Chip, ChipRow } from '@/components/chip';
import { episodeCode, fileSize, followersLabel, formatCommunityRating, formatName, formatRuntime, hdrName, resolutionName, spatialName, timeLeft } from '@/components/labels';
import { progressOf, ProgressBar, WatchedBadge } from '@/components/media/badges';
import { itemHref, keyHref, playHref, routeId } from '@/components/media/item-link';
import { SourceNotices } from '@/components/media/source-notices';
import { TitleMenu } from '@/components/media/title-menu';
import { Scrim } from '@/components/scrim';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { Screen } from '@/components/screen';
import { SourceTabs } from '@/components/source-tabs';
import { useServices } from '@/hooks/services-context';
import { useDownloadBudget } from '@/hooks/use-downloads';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useChildren, useItem, useRefreshMedia } from '@/hooks/use-media';
import { usePlayers } from '@/hooks/use-players';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';
import type { SourceError } from '@/services/media';

import { CollectionPage } from './channel';

// The page's column, which what lies over the hero lines up with.
const PAGE_WIDTH = px(1100);

/** A film, a series with its seasons and episodes, or one episode — whatever the key points at. */
export function DetailScreen({ connectionId, itemId, season }: { connectionId: ConnectionId; itemId: string; season?: string }) {
  const detail = useItem({ connectionId, externalId: itemId });
  // Every source of the profile: an IPTV provider's films open here from the Live tab.
  const { data: sources = [] } = useSources();
  const source = sources.find((candidate) => candidate.connection.id === connectionId);
  const capabilities = source?.effective.media?.capabilities;
  const can = (capability: MediaCapability) => capabilities?.has(capability) ?? false;
  // Whoever keeps it: the source, or the app for one that keeps none.
  const showWatch = source?.watch !== undefined;
  const withKept = useKeptWatch(detail.data ? [detail.data.detail.item] : []);

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
  return (
    <Detail
      detail={{ ...detail.data.detail, item: withKept(detail.data.detail.item) }}
      showWatch={showWatch}
      canPlay={can('playback')}
      // The app takes the mark itself where it keeps watch status; a source that keeps its own hears it later.
      canMarkWatched={source?.watch === 'app' || can('watchStateWrite')}
      canDownload={can('downloads')}
      offersChoices={can('downloadOptions')}
      canFollow={can('feed')}
      {...(season ? { season } : {})}
      {...(detail.data.sourceError ? { sourceError: detail.data.sourceError } : {})}
    />
  );
}

function Detail({
  detail,
  showWatch,
  canPlay,
  canMarkWatched,
  canDownload,
  offersChoices,
  canFollow,
  season,
  sourceError,
}: {
  detail: MediaDetail;
  showWatch: boolean;
  canPlay: boolean;
  canMarkWatched: boolean;
  canDownload: boolean;
  /** The source will offer versions to choose between, rather than one copy. */
  offersChoices: boolean;
  /** The source brings a feed, so following a channel means something. */
  canFollow: boolean;
  season?: string;
  /** The source could not answer; this page shows what was saved from it. */
  sourceError?: SourceError;
}) {
  const { item, people, studios, tagline, versions, creator } = detail;
  const refresh = useRefreshMedia();
  if (item.type === 'channel' || item.type === 'playlist') {
    return <CollectionPage detail={{ ...detail, item }} showWatch={showWatch} canFollow={canFollow} {...(sourceError ? { sourceError } : {})} />;
  }
  return (
    <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="never">
      <Hero item={item} />
      <YStack px="$4" pt="$3" pb="$12" gap="$5" width="100%" maxW={PAGE_WIDTH} self="center">
        {sourceError ? <SourceNotices errors={[sourceError]} onRetry={() => void refresh()} /> : null}
        <Meta item={item} />
        <Actions item={item} canPlay={canPlay} canMarkWatched={canMarkWatched} canDownload={canDownload} offersChoices={offersChoices} />
        {creator ? <CreatorRow creator={creator} /> : null}
        {showWatch ? <WatchState item={item} /> : null}
        {tagline ? (
          <SizableText size="$5" color="$color11" fontStyle="italic">
            {tagline}
          </SizableText>
        ) : null}
        {item.overview ? (
          <Paragraph size="$4" color="$color11" maxW={px(760)}>
            {item.overview}
          </Paragraph>
        ) : null}
        {item.type === 'episode' ? <ShowLink episode={item} /> : null}
        {item.type === 'show' ? <Seasons show={item} showWatch={showWatch} {...(season ? { initial: season } : {})} /> : null}
        {people.length > 0 ? <People people={people} connectionId={item.key.connectionId} /> : null}
        <MediaSummary item={item} versions={versions} />
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
  // A cover and nothing wider — what an IPTV provider has for its films and
  // series — is shown as a cover, rather than a slice of it stretched across
  // the page.
  if (item.type !== 'episode' && !item.images.backdrop && !item.images.thumb && item.images.poster) {
    return <CoverHero item={item} poster={item.images.poster} width={width} height={Math.round(width / aspect)} />;
  }
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
      <OverHero>
        <YStack gap="$2" maxW={px(680)}>
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
      </OverHero>
    </YStack>
  );
}

/**
 * What lies over a hero, in the page's column: a title's logo lines up with
 * the year and the buttons beneath it rather than with the picture's edge —
 * which, on a TV, the column keeps well inside of.
 */
function OverHero({ children }: { children: ReactNode }) {
  return (
    <YStack position="absolute" l={0} r={0} b="$4" items="center">
      <YStack width="100%" maxW={PAGE_WIDTH} px="$4">
        {children}
      </YStack>
    </YStack>
  );
}

/** The cover beside the title, over a softened, darkened copy of itself. */
function CoverHero({ item, poster, width, height }: { item: MediaItem; poster: ImageRef; width: number; height: number }) {
  const coverWidth = Math.round(Math.min(220, Math.max(110, width * 0.28)));
  // Tall enough for the whole cover under the header that floats over it.
  const tall = Math.max(height, Math.round(coverWidth * 1.5) + 120);
  return (
    <YStack position="relative" width={width} height={tall} bg="$color2">
      <Artwork connectionId={item.key.connectionId} image={poster} width={width} aspect={width / tall} label={item.title} rounded="$0" blur={30} />
      <Scrim from="top" strength={0.6} />
      <Scrim from="bottom" />
      <OverHero>
        <XStack gap="$4" items="flex-end">
          <Artwork connectionId={item.key.connectionId} image={poster} width={coverWidth} aspect={2 / 3} label={item.title} rounded="$5" />
          <YStack flex={1} pb="$1">
            <H1 size="$9" color="$color12" numberOfLines={3}>
              {item.title}
            </H1>
          </YStack>
        </XStack>
      </OverHero>
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

/**
 * Play, or Resume where the source says it stopped — for a film or an
 * episode, where the source can play — and the eye: watched or not, where it
 * keeps what was watched, written here first and heard by the source later.
 * The rest — another player, a copy, a list — waits behind "⋯": in the
 * header that floats over the artwork, or at the end of the row on a TV,
 * which has no header.
 */
function Actions({
  item,
  canPlay,
  canMarkWatched,
  canDownload,
  offersChoices,
}: {
  item: MediaItem;
  canPlay: boolean;
  canMarkWatched: boolean;
  canDownload: boolean;
  offersChoices: boolean;
}) {
  const userId = useActiveUserId();
  const { watch } = useServices();
  const { data: players = [] } = usePlayers();
  const { data: budget } = useDownloadBudget();
  const [menuOpen, setMenuOpen] = useState(false);
  const mark = useMutation({ mutationFn: (played: boolean) => watch.setPlayed(userId, item, played), networkMode: 'always' });
  const playable = canPlay && (item.type === 'movie' || item.type === 'episode');
  // Only a single playable thing is worth keeping — a series is its episodes —
  // and a browser or a TV has nowhere to keep it.
  const keepable = canDownload && (item.type === 'movie' || item.type === 'episode') && budget?.limitBytes !== 0;
  const resumeAt = item.watch && !item.watch.played ? item.watch.positionMs : undefined;
  // "Play with…" offers the players that are on and can play here — and only when there is a choice.
  const here = players.filter((player) => player.enabled && player.playsHere);
  // A list may hold anything playable from any source, so it is offered wherever Play is.
  const hasMenu = playable || keepable;
  if (!playable && !canMarkWatched && !hasMenu) return null;
  const play = (startMs?: number, player?: PluginId) =>
    router.push(playHref(item.key, { ...(startMs ? { startMs } : {}), ...(player ? { player } : {}) }));
  const played = item.watch?.played ?? false;
  const openMenu = () => setMenuOpen(true);
  return (
    <>
      {isTV ? null : <Stack.Screen options={{ headerRight: () => (hasMenu ? <MoreButton label="More" onPress={openMenu} /> : null) }} />}
      <XStack gap="$3" flexWrap="wrap" items="center">
        {playable ? (
          <ActionButton
            primary
            preferred
            icon={<Play size={18} fill="currentColor" />}
            label={resumeAt ? 'Resume' : 'Play'}
            onPress={() => play(resumeAt)}
          />
        ) : null}
        {playable && resumeAt ? <ActionButton icon={<RotateCcw size={18} />} label="From the beginning" onPress={() => play()} /> : null}
        {canMarkWatched ? (
          <ActionButton
            icon={played ? <EyeFilled size={20} /> : <Eye size={20} />}
            label={played ? 'Mark as unwatched' : 'Mark as watched'}
            disabled={mark.isPending}
            onPress={() => mark.mutate(!played)}
          />
        ) : null}
        {hasMenu && isTV ? <ActionButton icon={<Ellipsis size={20} />} label="More" onPress={openMenu} /> : null}
      </XStack>
      {hasMenu ? (
        <TitleMenu
          item={item}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          players={playable ? here : []}
          canList={playable}
          keepable={keepable}
          offersChoices={offersChoices}
          onPlayWith={(player) => play(resumeAt, player)}
        />
      ) : null}
    </>
  );
}

/** The channel behind a video: its face and name, opening its page. */
function CreatorRow({ creator }: { creator: Creator }) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Link href={keyHref(creator.key)} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${creator.name}, the channel`} {...handlers}>
        {({ pressed }) => (
          <XStack gap="$3" items="center" opacity={pressed ? 0.8 : 1} self="flex-start">
            <Artwork connectionId={creator.key.connectionId} image={creator.avatar} width={px(40)} aspect={1} label={creator.name} rounded={999} />
            <YStack>
              <SizableText size="$4" fontWeight="600" color={focused ? '$accent11' : '$color12'}>
                {creator.name}
              </SizableText>
              {creator.followers === undefined ? null : (
                <SizableText size="$2" color="$color10">
                  {followersLabel(creator.followers)}
                </SizableText>
              )}
            </YStack>
            <ChevronRight size={18} color="$color10" />
          </XStack>
        )}
      </Pressable>
    </Link>
  );
}

function WatchState({ item }: { item: MediaItem }) {
  const progress = progressOf(item);
  if (item.watch?.played) {
    return (
      <XStack gap="$2" items="center">
        <Check size={16} color="$green10" />
        <SizableText size="$3" color="$green11">
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
    <YStack gap="$2" maxW={px(420)}>
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

/**
 * What the file is, in one line, opening the whole of it. Absent where the
 * source does not say — Stalker and the mocks never will, and a screen must
 * not guess.
 */
function MediaSummary({ item, versions }: { item: MediaItem; versions: readonly MediaVersion[] | undefined }) {
  const version = versions?.[0];
  if (!version) return null;
  const summary = summarise(version, versions.length);
  if (!summary) return null;
  return (
    <SettingsSection>
      <SettingsRow
        title="Media details"
        subtitle={summary}
        href={{
          pathname: '/media-info/[connectionId]/[itemId]',
          params: { connectionId: item.key.connectionId, itemId: routeId(item.key.externalId) },
        }}
      />
    </SettingsSection>
  );
}

/** "4K · Dolby Vision · Dolby Atmos · 64 GB" — the things worth knowing before pressing Play. */
function summarise(version: MediaVersion, count: number): string {
  const spatial = version.audio.find((track) => track.spatial !== undefined)?.spatial;
  return [
    count > 1 ? `${count} versions` : undefined,
    resolutionName(version.video?.height, version.video?.width),
    version.video?.hdr === undefined ? undefined : hdrName(version.video.hdr),
    version.video?.codec === undefined ? undefined : formatName(version.video.codec),
    // Named only where the source said so: Atmos cannot be read off a codec.
    spatial === undefined ? undefined : spatialName(spatial),
    fileSize(version.sizeBytes),
  ]
    .filter(Boolean)
    .join(' · ');
}

function ShowLink({ episode }: { episode: Episode }) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Link href={keyHref(episode.show)} asChild>
      <Pressable accessibilityRole="link" {...handlers}>
        <XStack gap="$1" items="center">
          <SizableText size="$4" color="$accent11" fontWeight="600" textDecorationLine={focused ? 'underline' : 'none'}>
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
  const list = seasons.data?.items ?? [];
  const [chosen, setChosen] = useState(initial);
  const unfinished = list.find((season) => season.watch !== undefined && !season.watch.played);
  const selected = list.find((season) => season.key.externalId === chosen) ?? unfinished ?? list[0];
  const episodes = useChildren(selected);
  const withKept = useKeptWatch(episodes.data?.items ?? []);

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
        {(episodes.data?.items ?? []).map((child) => {
          const episode = withKept(child);
          return episode.type === 'episode' ? <EpisodeRow key={episode.key.externalId} episode={episode} showWatch={showWatch} /> : null;
        })}
      </YStack>
    </YStack>
  );
}

function EpisodeRow({ episode, showWatch }: { episode: Episode; showWatch: boolean }) {
  const progress = showWatch ? progressOf(episode) : undefined;
  const { focused, handlers } = useRemoteFocus();
  const facts = [episode.runtimeMs ? formatRuntime(episode.runtimeMs) : undefined, episode.airDate].filter(Boolean).join(' · ');
  return (
    <Link href={itemHref(episode)} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${episodeCode(episode)} ${episode.title}`} {...handlers}>
        {({ pressed }) => (
          <XStack gap="$3" opacity={pressed ? 0.8 : 1}>
            <YStack position="relative" {...(focused ? CARD_FOCUSED : {})}>
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
              <SizableText size="$4" color={focused ? '$accent11' : '$color12'} numberOfLines={2}>
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
