import type { ConnectionId, DownloadOption, Episode, MediaCapability, MediaDetail, MediaItem, MediaVersion, Person, PluginId, Show } from '@sc/api';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { Download as DownloadIcon } from '@tamagui/lucide-icons-2/icons/Download';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { Button, H1, H3, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Artwork, ArtworkLogo } from '@/components/artwork';
import { PrimaryButton } from '@/components/primary-button';
import { Chip, ChipRow } from '@/components/chip';
import { episodeCode, fileSize, formatCommunityRating, formatName, formatRuntime, hdrName, resolutionName, spatialName, timeLeft } from '@/components/labels';
import { progressOf, ProgressBar, WatchedBadge } from '@/components/media/badges';
import { itemHref } from '@/components/media/item-link';
import { SourceNotices } from '@/components/media/source-notices';
import { Scrim } from '@/components/scrim';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { Screen } from '@/components/screen';
import { SourceTabs } from '@/components/source-tabs';
import { useServices } from '@/hooks/services-context';
import { useDownloadActions, useDownloadBudget, useDownloadOf, useDownloadOptions } from '@/hooks/use-downloads';
import { useChildren, useItem, useRefreshMedia } from '@/hooks/use-media';
import { usePlayers } from '@/hooks/use-players';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';
import type { SourceError } from '@/services/media';

/** A film, a series with its seasons and episodes, or one episode — whatever the key points at. */
export function DetailScreen({ connectionId, itemId, season }: { connectionId: ConnectionId; itemId: string; season?: string }) {
  const detail = useItem({ connectionId, externalId: itemId });
  // Every source of the profile: an IPTV provider's films open here from the TV tab.
  const { data: sources = [] } = useSources();
  const capabilities = sources.find((source) => source.connection.id === connectionId)?.effective.media?.capabilities;
  const can = (capability: MediaCapability) => capabilities?.has(capability) ?? false;
  const showWatch = can('watchStateRead');

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
      detail={detail.data.detail}
      showWatch={showWatch}
      canPlay={can('playback')}
      canMarkWatched={can('watchStateWrite')}
      canDownload={can('downloads')}
      offersChoices={can('downloadOptions')}
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
  season?: string;
  /** The source could not answer; this page shows what was saved from it. */
  sourceError?: SourceError;
}) {
  const { item, people, studios, tagline, versions } = detail;
  const refresh = useRefreshMedia();
  return (
    <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="never">
      <Hero item={item} />
      <YStack px="$4" pt="$3" pb="$12" gap="$5" width="100%" maxW={1100} self="center">
        {sourceError ? <SourceNotices errors={[sourceError]} onRetry={() => void refresh()} /> : null}
        <Meta item={item} />
        <Actions item={item} canPlay={canPlay} canMarkWatched={canMarkWatched} canDownload={canDownload} offersChoices={offersChoices} />
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

/**
 * Play, or Resume where the source says it stopped — for a film or an
 * episode, where the source can play. Watched and unwatched, where it keeps
 * what was watched: written here first, the source hears later.
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
  const [choosing, setChoosing] = useState(false);
  const mark = useMutation({ mutationFn: (played: boolean) => watch.setPlayed(userId, item, played), networkMode: 'always' });
  const playable = canPlay && (item.type === 'movie' || item.type === 'episode');
  // Only a single playable thing is worth keeping: a series is its episodes.
  const keepable = canDownload && (item.type === 'movie' || item.type === 'episode');
  const resumeAt = item.watch && !item.watch.played ? item.watch.positionMs : undefined;
  // "Play with…" offers the players that are on and can play here — and only when there is a choice.
  const here = players.filter((player) => player.enabled && player.playsHere);
  if (!playable && !canMarkWatched && !keepable) return null;
  const play = (startMs?: number, player?: PluginId) =>
    router.push({
      pathname: '/play/[connectionId]/[itemId]',
      params: {
        connectionId: item.key.connectionId,
        itemId: item.key.externalId,
        ...(startMs ? { start: String(startMs) } : {}),
        ...(player ? { player } : {}),
      },
    });
  const played = item.watch?.played ?? false;
  return (
    <YStack gap="$3">
      <XStack gap="$3" flexWrap="wrap" items="center">
        {playable ? (
          <PrimaryButton size="$4" icon={<Play size={18} fill="currentColor" />} onPress={() => play(resumeAt)}>
            {resumeAt ? 'Resume' : 'Play'}
          </PrimaryButton>
        ) : null}
        {playable && resumeAt ? (
          <Button size="$4" onPress={() => play()}>
            From the beginning
          </Button>
        ) : null}
        {playable && here.length > 1 ? (
          <Button size="$4" aria-expanded={choosing} onPress={() => setChoosing(!choosing)}>
            Play with…
          </Button>
        ) : null}
        {canMarkWatched ? (
          <Button size="$4" {...(played ? {} : { icon: <Check size={18} /> })} disabled={mark.isPending} onPress={() => mark.mutate(!played)}>
            {played ? 'Mark unwatched' : 'Mark watched'}
          </Button>
        ) : null}
        {keepable ? <DownloadButton item={item} offersChoices={offersChoices} /> : null}
      </XStack>
      {playable && choosing ? (
        <XStack gap="$2" flexWrap="wrap" items="center">
          {here.map((player) => (
            <Button key={player.manifest.id} size="$3" onPress={() => play(resumeAt, player.manifest.id)} aria-label={`Play with ${player.manifest.displayName}`}>
              {player.manifest.displayName}
            </Button>
          ))}
        </XStack>
      ) : null}
    </YStack>
  );
}

/**
 * Keep a copy, and say where it has got to. Where the source offers versions
 * it opens a sheet of them with their sizes; where it does not, one press
 * takes whatever the source hands over.
 */
function DownloadButton({ item, offersChoices }: { item: MediaItem; offersChoices: boolean }) {
  const { data: entry } = useDownloadOf(item.key);
  const { data: budget } = useDownloadBudget();
  const { start, remove } = useDownloadActions();
  const [choosing, setChoosing] = useState(false);
  const { data: options = [], isPending: loadingOptions } = useDownloadOptions(item.key, choosing);

  // A browser has nowhere to keep it.
  if (budget?.limitBytes === 0) return null;

  if (entry?.state === 'done') {
    return (
      <Button size="$4" icon={<Check size={18} />} onPress={() => remove.mutate(entry.id)} aria-label="Downloaded — press to delete">
        Downloaded
      </Button>
    );
  }
  if (entry) {
    const percent =
      entry.bytesTotal === undefined || entry.bytesTotal === 0 ? undefined : Math.round((entry.bytesDone / entry.bytesTotal) * 100);
    return (
      <Button size="$4" disabled aria-label="Downloading">
        {entry.state === 'failed' ? 'Download failed' : percent === undefined ? 'Downloading…' : `Downloading ${percent}%`}
      </Button>
    );
  }
  if (budget?.full) {
    return (
      <Button size="$4" disabled aria-label="No room for downloads">
        No room left
      </Button>
    );
  }

  return (
    <>
      <Button
        size="$4"
        icon={<DownloadIcon size={18} />}
        disabled={start.isPending}
        onPress={() => (offersChoices ? setChoosing(!choosing) : start.mutate({ item }))}
        aria-expanded={offersChoices ? choosing : undefined}
      >
        Download
      </Button>
      {choosing ? (
        <XStack gap="$2" flexWrap="wrap" items="center" width="100%">
          {loadingOptions ? (
            <SizableText size="$2" color="$color10">
              Asking the server…
            </SizableText>
          ) : options.length === 0 ? (
            <Button size="$3" onPress={() => start.mutate({ item })}>
              Download as it is
            </Button>
          ) : (
            options.map((option) => (
              <Button
                key={option.id}
                size="$3"
                aria-label={optionLabel(option)}
                onPress={() => {
                  setChoosing(false);
                  start.mutate({ item, optionId: option.id });
                }}
              >
                {optionLabel(option)}
              </Button>
            ))
          )}
        </XStack>
      ) : null}
    </>
  );
}

/** "1080p · 4.2 GB", with an estimate marked as one. */
function optionLabel(option: DownloadOption): string {
  const size = fileSize(option.estimatedBytes);
  return [
    option.label ?? resolutionName(option.height) ?? 'Original',
    size === undefined ? undefined : option.transcoded ? `about ${size}` : size,
  ]
    .filter(Boolean)
    .join(' · ');
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
          params: { connectionId: item.key.connectionId, itemId: item.key.externalId },
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
  const list = seasons.data?.items ?? [];
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
        {(episodes.data?.items ?? []).map((episode) =>
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
