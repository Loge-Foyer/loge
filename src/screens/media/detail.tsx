import type { ConnectionId, Creator, DownloadOption, Episode, ImageRef, MediaCapability, MediaDetail, MediaItem, MediaVersion, Person, PluginId, Show } from '@sc/api';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { CirclePlay } from '@tamagui/lucide-icons-2/icons/CirclePlay';
import { Download as DownloadIcon } from '@tamagui/lucide-icons-2/icons/Download';
import { Ellipsis } from '@tamagui/lucide-icons-2/icons/Ellipsis';
import { Eye } from '@tamagui/lucide-icons-2/icons/Eye';
import { ListPlus } from '@tamagui/lucide-icons-2/icons/ListPlus';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2';
import { useMutation } from '@tanstack/react-query';
import { Link, router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { H1, H3, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { ActionButton } from '@/components/action-button';
import { px } from '@/components/density';
import { Artwork, ArtworkLogo } from '@/components/artwork';
import { EyeFilled } from '@/components/icons';
import { Menu, MenuHeader, MenuNote, MenuRow, MoreButton } from '@/components/more-menu';
import { CARD_FOCUSED, isTV, useRemoteFocus } from '@/components/remote';
import { Chip, ChipRow } from '@/components/chip';
import { episodeCode, fileSize, followersLabel, formatCommunityRating, formatName, formatRuntime, hdrName, resolutionName, spatialName, timeLeft } from '@/components/labels';
import { progressOf, ProgressBar, WatchedBadge } from '@/components/media/badges';
import { itemHref, keyHref, playHref, routeId } from '@/components/media/item-link';
import { SourceNotices } from '@/components/media/source-notices';
import { Scrim } from '@/components/scrim';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { Screen } from '@/components/screen';
import { SourceTabs } from '@/components/source-tabs';
import { useServices } from '@/hooks/services-context';
import { useDownloadActions, useDownloadBudget, useDownloadOf, useDownloadOptions } from '@/hooks/use-downloads';
import { useListActions, usePlaylists } from '@/hooks/use-lists';
import { useChildren, useItem, useRefreshMedia } from '@/hooks/use-media';
import { usePlayers } from '@/hooks/use-players';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';
import type { SourceError } from '@/services/media';

import { CollectionPage } from './channel';
import type { PlayerSummary } from '@/services/players';
import type { Playlist } from '@/services/ports';

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
      <YStack px="$4" pt="$3" pb="$12" gap="$5" width="100%" maxW={px(1100)} self="center">
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
      <YStack position="absolute" l="$4" r="$4" b="$4" gap="$2" maxW={px(680)}>
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
      <XStack position="absolute" l="$4" r="$4" b="$4" gap="$4" items="flex-end">
        <Artwork connectionId={item.key.connectionId} image={poster} width={coverWidth} aspect={2 / 3} label={item.title} rounded="$5" />
        <YStack flex={1} pb="$1">
          <H1 size="$9" color="$color12" numberOfLines={3}>
            {item.title}
          </H1>
        </YStack>
      </XStack>
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

type MenuPage = 'root' | 'players' | 'lists' | 'download';

const MENU_ICON = { size: px(18), color: '$color11' } as const;

/** What waits behind "⋯": another player, a copy kept on this device, and the profile's own lists. */
function TitleMenu({
  item,
  open,
  onClose,
  players,
  canList,
  keepable,
  offersChoices,
  onPlayWith,
}: {
  item: MediaItem;
  open: boolean;
  onClose: () => void;
  /** The players that can play it here — "Play with…" only when there is more than one. */
  players: readonly PlayerSummary[];
  canList: boolean;
  keepable: boolean;
  offersChoices: boolean;
  onPlayWith: (player: PluginId) => void;
}) {
  const [page, setPage] = useState<MenuPage>('root');
  const choosesPlayer = players.length > 1;
  const close = () => {
    onClose();
    setPage('root');
  };
  const back = () => setPage('root');
  return (
    <Menu open={open} label={`More for ${item.title}`} onClose={close}>
      {page === 'players' ? (
        <>
          <MenuHeader title="Play with" onBack={back} />
          {players.map((player, index) => (
            <MenuRow
              key={player.manifest.id}
              label={player.manifest.displayName}
              preferred={index === 0}
              onPress={() => {
                close();
                onPlayWith(player.manifest.id);
              }}
            />
          ))}
        </>
      ) : page === 'lists' ? (
        <ListsPage item={item} onBack={back} />
      ) : page === 'download' ? (
        <DownloadPage item={item} onBack={back} onDone={close} />
      ) : (
        <>
          {choosesPlayer ? (
            <MenuRow icon={<CirclePlay {...MENU_ICON} />} label="Play with…" more preferred onPress={() => setPage('players')} />
          ) : null}
          {keepable ? (
            <DownloadRow item={item} offersChoices={offersChoices} preferred={!choosesPlayer} onChoose={() => setPage('download')} onDone={close} />
          ) : null}
          {canList ? <ListsRow item={item} preferred={!choosesPlayer && !keepable} onPress={() => setPage('lists')} /> : null}
        </>
      )}
    </Menu>
  );
}

const holds = (list: Playlist, item: MediaItem) =>
  list.items.some((entry) => entry.connectionId === item.key.connectionId && entry.externalId === item.key.externalId);

function ListsRow({ item, preferred, onPress }: { item: MediaItem; preferred: boolean; onPress: () => void }) {
  const { data: lists = [] } = usePlaylists();
  const count = lists.filter((list) => holds(list, item)).length;
  return (
    <MenuRow
      icon={<ListPlus {...MENU_ICON} />}
      label="Add to list"
      {...(count === 0 ? {} : { detail: count === 1 ? 'In 1 list' : `In ${count} lists` })}
      more
      preferred={preferred}
      onPress={onPress}
    />
  );
}

/** The profile's own lists, each ticked where it holds this — a press puts it in, or takes it out. */
function ListsPage({ item, onBack }: { item: MediaItem; onBack: () => void }) {
  const { data: lists = [] } = usePlaylists();
  const { add, removeItem, create } = useListActions();
  return (
    <>
      <MenuHeader title="Add to list" onBack={onBack} />
      {lists.map((list, index) => {
        const inIt = holds(list, item);
        return (
          <MenuRow
            key={list.id}
            label={list.title}
            selected={inIt}
            preferred={index === 0}
            onPress={() => (inIt ? removeItem : add).mutate({ id: list.id, key: item.key })}
          />
        );
      })}
      <MenuRow
        icon={<Plus {...MENU_ICON} />}
        label="New list"
        // Named after what starts it, which is nearly always right and always renameable.
        detail={item.title}
        preferred={lists.length === 0}
        disabled={create.isPending}
        onPress={() => create.mutate(item.title, { onSuccess: (list) => add.mutate({ id: list.id, key: item.key }) })}
      />
    </>
  );
}

/**
 * Keep a copy, and say where it has got to. Where the source offers versions
 * it opens a page of them with their sizes; where it does not, one press takes
 * whatever the source hands over.
 */
function DownloadRow({
  item,
  offersChoices,
  preferred,
  onChoose,
  onDone,
}: {
  item: MediaItem;
  offersChoices: boolean;
  preferred: boolean;
  onChoose: () => void;
  onDone: () => void;
}) {
  const { data: entry } = useDownloadOf(item.key);
  const { data: budget } = useDownloadBudget();
  const { start, remove } = useDownloadActions();
  const icon = <DownloadIcon {...MENU_ICON} />;
  if (entry?.state === 'done') {
    return (
      <MenuRow
        icon={<Trash2 {...MENU_ICON} />}
        label="Delete download"
        detail="Kept on this device"
        preferred={preferred}
        onPress={() => {
          remove.mutate(entry.id);
          onDone();
        }}
      />
    );
  }
  if (entry) {
    const percent =
      entry.bytesTotal === undefined || entry.bytesTotal === 0 ? undefined : Math.round((entry.bytesDone / entry.bytesTotal) * 100);
    return (
      <MenuRow
        icon={icon}
        label={entry.state === 'failed' ? 'Download failed' : 'Downloading'}
        {...(entry.state === 'failed' || percent === undefined ? {} : { detail: `${percent} %` })}
        disabled
      />
    );
  }
  if (budget?.full) return <MenuRow icon={icon} label="Download" detail="No room left" disabled />;
  return (
    <MenuRow
      icon={icon}
      label="Download"
      more={offersChoices}
      preferred={preferred}
      disabled={start.isPending}
      onPress={() => {
        if (offersChoices) {
          onChoose();
          return;
        }
        start.mutate({ item });
        onDone();
      }}
    />
  );
}

/** The versions the source will hand over, each with its size — asked for when this page opens. */
function DownloadPage({ item, onBack, onDone }: { item: MediaItem; onBack: () => void; onDone: () => void }) {
  const { start } = useDownloadActions();
  const { data: options = [], isPending } = useDownloadOptions(item.key, true);
  const take = (optionId?: string) => {
    start.mutate({ item, ...(optionId ? { optionId } : {}) });
    onDone();
  };
  return (
    <>
      <MenuHeader title="Download" onBack={onBack} />
      {isPending ? (
        <MenuNote>Asking the server…</MenuNote>
      ) : options.length === 0 ? (
        <MenuRow label="Download as it is" preferred onPress={() => take()} />
      ) : (
        options.map((option, index) => (
          <MenuRow key={option.id} label={optionLabel(option)} preferred={index === 0} onPress={() => take(option.id)} />
        ))
      )}
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
