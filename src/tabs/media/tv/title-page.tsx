import type { Episode, GlobalMediaKey, MediaDetail, MediaItem, Show } from '@loge/api';
import { Ellipsis } from '@tamagui/lucide-icons-2/icons/Ellipsis';
import { Eye } from '@tamagui/lucide-icons-2/icons/Eye';
import { LayoutGrid } from '@tamagui/lucide-icons-2/icons/LayoutGrid';
import { ListVideo } from '@tamagui/lucide-icons-2/icons/ListVideo';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { Star } from '@tamagui/lucide-icons-2/icons/Star';
import { router } from 'expo-router';
import { useRef, useState, type ReactElement, type RefObject } from 'react';
import { Pressable, useWindowDimensions, type View } from 'react-native';
import { H1, Paragraph, SizableText, Spinner, Theme, useTheme, XStack, YStack } from 'tamagui';

import { Artwork, ArtworkLogo } from '@/components/artwork';
import { GUTTER, px } from '@/components/density';
import { FocusGroup } from '@/components/focus-group';
import { EyeFilled } from '@/components/icons';
import { episodeCode, formatCommunityRating } from '@/components/labels';
import { BoxBadge } from '@/components/media/badges';
import { titleKeyHref } from '@/components/media/item-link';
import { SourceNotices } from '@/components/media/source-notices';
import { TitleMenu } from '@/components/media/title-menu';
import { Scrim } from '@/components/scrim';
import { CHOSEN } from '@/components/settings-list';
import { useBackLayers } from '@/hooks/use-back-layers';
import { useRefreshMedia } from '@/hooks/use-media';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

import { resumeAtOf, useTitleActions } from '../shared/title-actions';
import { useTitle } from '../shared/title-data';
import { creditsOf, factsOf, leftOf, qualityBadges } from '../shared/title-meta';
import { useUpNext } from '../shared/up-next';
import { EpisodesPanel, SidePanel, SimilarPanel } from './side-panel';

type Panel = 'episodes' | 'like';

const ICON = px(22);

// An action's symbol: in the accent's own colour on its pill, else the page's.
type IconColor = '$accentColor' | '$color12';

/**
 * A title's page on a TV, pushed so the remote's focus reaches it: its
 * picture across the screen, and down the left its logo, its facts, what it is
 * about and who is in it, then what can be done — Play or Resume first, where
 * the focus starts. Episodes and More like this slide in from the right; Back
 * closes them before the page, and the focus goes back to what opened them.
 * It is drawn dark in either scheme: all of it sits on a picture.
 */
export function TvTitlePage({ itemKey, season }: { itemKey: GlobalMediaKey; season?: string }) {
  const title = useTitle(itemKey);
  return (
    <Theme name="dark">
      <YStack flex={1} bg="$background">
        {title.detail ? (
          <Page detail={title.detail} title={title} season={season} />
        ) : title.isPending ? (
          <Spinner size="large" color="$accent9" m="auto" />
        ) : (
          <SizableText size="$5" color="$color10" px={GUTTER} pt={px(64)}>
            {title.error?.message ?? 'This title could not be opened.'}
          </SizableText>
        )}
      </YStack>
    </Theme>
  );
}

function Page({ detail, title, season }: { detail: MediaDetail; title: ReturnType<typeof useTitle>; season: string | undefined }) {
  const { item } = detail;
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const refresh = useRefreshMedia();
  const { play, mark } = useTitleActions(item);
  const upNext = useUpNext(item.type === 'show' ? (item as Show) : undefined);
  // A link that names a season opens on its episodes.
  const [panel, setPanel] = useState<Panel | undefined>(item.type === 'show' && season !== undefined ? 'episodes' : undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const episodesOpener = useRef<View>(null);
  const likeOpener = useRef<View>(null);
  const playing: MediaItem | undefined = item.type === 'show' ? upNext : item.type === 'movie' || item.type === 'episode' ? item : undefined;
  const resumeAt = resumeAtOf(playing);
  const played = item.watch?.played ?? false;
  const playable = title.canPlay && playing !== undefined;
  const keepable = title.keepable(item);
  const hasMenu = playable || keepable;
  const image = item.type === 'episode' ? (item.images.thumb ?? item.images.backdrop) : (item.images.backdrop ?? item.images.thumb ?? item.images.poster);

  const closePanel = () => {
    if (!panel) return;
    const opener = panel === 'episodes' ? episodesOpener : likeOpener;
    setPanel(undefined);
    // Once the panel has gone, the focus goes back to the button that opened it.
    requestAnimationFrame(() => opener.current?.requestTVFocus());
  };
  useBackLayers(panel ? closePanel : undefined);

  return (
    <YStack flex={1}>
      <YStack position="absolute" t={0} l={0}>
        <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={width / height} label={item.title} rounded="$0" />
      </YStack>
      {/* Twice from the left: dense behind the words, clear by two thirds across. */}
      <Scrim from="left" />
      <Scrim from="left" strength={0.75} />
      <Scrim from="bottom" strength={0.5} />
      <YStack width={Math.round(width * 0.44)} pl={GUTTER} pt={px(48)} gap="$4">
        {title.sourceError ? <SourceNotices errors={[title.sourceError]} onRetry={() => void refresh()} /> : null}
        {item.type === 'episode' ? (
          <SizableText size="$5" fontWeight="600" color="$color11">
            {[item.showTitle, episodeCode(item)].filter(Boolean).join(' · ')}
          </SizableText>
        ) : null}
        <ArtworkLogo
          connectionId={item.key.connectionId}
          image={item.type === 'episode' ? undefined : item.images.logo}
          width={px(360)}
          height={px(120)}
          label={item.title}
          fallback={
            <H1 size="$10" color="$color12" numberOfLines={2}>
              {item.title}
            </H1>
          }
        />
        <Facts detail={detail} />
        {item.overview ? (
          <Paragraph size="$5" color="$color12" numberOfLines={3}>
            {item.overview}
          </Paragraph>
        ) : null}
        <People detail={detail} />
        <FocusGroup>
          <YStack gap="$1" pt="$2" width={px(400)}>
            {playable && playing ? (
              <Action
                preferred
                icon={(color) => <Play size={ICON} color={color} fill="currentColor" />}
                label={playLabel(item, playing, resumeAt)}
                onPress={() => play(playing)}
              />
            ) : null}
            {playable && playing && resumeAt !== undefined ? (
              <Action icon={(color) => <RotateCcw size={ICON} color={color} />} label="From the beginning" onPress={() => play(playing, { fromStart: true })} />
            ) : null}
            {item.type === 'show' ? (
              <Action actionRef={episodesOpener} icon={(color) => <ListVideo size={ICON} color={color} />} label="Episodes" onPress={() => setPanel('episodes')} />
            ) : null}
            {item.type === 'episode' ? (
              <Action icon={(color) => <ListVideo size={ICON} color={color} />} label="All episodes" onPress={() => router.push(titleKeyHref(item.show))} />
            ) : null}
            {item.type === 'show' || item.type === 'movie' ? (
              <Action actionRef={likeOpener} icon={(color) => <LayoutGrid size={ICON} color={color} />} label="More like this" onPress={() => setPanel('like')} />
            ) : null}
            {title.canMarkWatched ? (
              <Action
                icon={(color) => (played ? <FilledEye token={color} /> : <Eye size={ICON} color={color} />)}
                label={played ? 'Mark as unwatched' : 'Mark as watched'}
                disabled={mark.isPending}
                onPress={() => mark.mutate(!played)}
              />
            ) : null}
            {hasMenu ? (
              <Action
                icon={(color) => <Ellipsis size={ICON} color={color} />}
                label="More…"
                onPress={() => {
                  // The menu is a modal, which Menu closes by itself: no panel waits under it.
                  setPanel(undefined);
                  setMenuOpen(true);
                }}
              />
            ) : null}
          </YStack>
        </FocusGroup>
      </YStack>
      {panel === 'episodes' && item.type === 'show' ? (
        <SidePanel key="episodes" title="Episodes" reduceMotion={reduceMotion}>
          <EpisodesPanel show={item} initial={season} showWatch={title.showWatch} canPlay={title.canPlay} onPlay={(episode: Episode) => play(episode)} />
        </SidePanel>
      ) : null}
      {panel === 'like' ? (
        <SidePanel key="like" title="More like this" reduceMotion={reduceMotion}>
          <SimilarPanel item={item} showWatch={title.showWatch} />
        </SidePanel>
      ) : null}
      {hasMenu ? (
        <TitleMenu
          item={playing ?? item}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          players={playable ? title.players : []}
          canList={playable}
          keepable={keepable}
          offersChoices={title.offersChoices}
          onPlayWith={(player) => {
            if (playing) play(playing, { player });
          }}
        />
      ) : null}
    </YStack>
  );
}

/** "Play", "Resume", or for a series which episode: "Resume S2 · E3". */
function playLabel(item: MediaItem, playing: MediaItem, resumeAt: number | undefined): string {
  const verb = resumeAt === undefined ? 'Play' : 'Resume';
  if (item.type !== 'show' || playing.type !== 'episode') return verb;
  const code = episodeCode(playing);
  return code ? `${verb} ${code}` : verb;
}

/** Its score, its years, its first genre, how long it runs or its seasons; then how it looks and sounds, and its age rating, boxed. */
function Facts({ detail }: { detail: MediaDetail }) {
  const { item } = detail;
  const left = item.type === 'movie' || item.type === 'episode' ? leftOf(item) : undefined;
  const genre = item.genres[0];
  const known = factsOf(item);
  // "2025 · Drama · 3 seasons": the genre after the year, where there is one.
  const facts = [
    ...(genre === undefined ? known : item.year === undefined ? [genre, ...known] : [...known.slice(0, 1), genre, ...known.slice(1)]),
    ...(left ? [left] : []),
  ];
  return (
    <XStack gap="$3" items="center" flexWrap="wrap">
      {item.ratings.community === undefined ? null : (
        <XStack gap="$1.5" items="center">
          <Star size={px(16)} color="$yellow10" fill="currentColor" />
          <SizableText size="$4" fontWeight="600" color="$color12">
            {formatCommunityRating(item.ratings.community)}
          </SizableText>
        </XStack>
      )}
      {facts.length > 0 ? (
        <SizableText size="$4" color="$color11">
          {facts.join('  ·  ')}
        </SizableText>
      ) : null}
      {qualityBadges(detail.versions).map((badge) => (
        <BoxBadge key={badge} label={badge} />
      ))}
      {item.contentRating ? <BoxBadge label={item.contentRating} filled /> : null}
    </XStack>
  );
}

/** Who is in it and who made it, a line each. */
function People({ detail }: { detail: MediaDetail }) {
  const { cast, makers, makersLabel } = creditsOf(detail.people);
  if (cast.length === 0 && makers.length === 0) return null;
  return (
    <YStack gap="$1">
      {cast.length > 0 ? (
        <SizableText size="$3" color="$color10" numberOfLines={1}>
          {`Cast: ${cast.slice(0, 4).join(', ')}`}
        </SizableText>
      ) : null}
      {makers.length > 0 ? (
        <SizableText size="$3" color="$color10" numberOfLines={1}>
          {`${makersLabel}: ${makers.join(', ')}`}
        </SizableText>
      ) : null}
    </YStack>
  );
}

/**
 * One of the page's actions: its symbol and its words, a pill in the accent
 * while the remote is on it.
 */
function Action({
  icon,
  label,
  preferred = false,
  disabled = false,
  actionRef,
  onPress,
}: {
  icon: (color: IconColor) => ReactElement;
  label: string;
  preferred?: boolean;
  disabled?: boolean;
  actionRef?: RefObject<View | null>;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const color: IconColor = focused ? '$accentColor' : '$color12';
  return (
    <Pressable
      ref={actionRef}
      onPress={onPress}
      disabled={disabled}
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <XStack height={px(44)} px="$4" gap="$3" items="center" rounded="$10" bg={focused ? CHOSEN.bg : 'transparent'} opacity={disabled ? 0.5 : 1}>
        {icon(color)}
        <SizableText size="$5" fontWeight="600" color={focused ? CHOSEN.color : '$color12'} numberOfLines={1}>
          {label}
        </SizableText>
      </XStack>
    </Pressable>
  );
}

/** The filled eye is drawn with a resolved colour, not a token. */
function FilledEye({ token }: { token: IconColor }) {
  const theme = useTheme();
  return <EyeFilled size={ICON} color={String((token === '$accentColor' ? theme.accentColor : theme.color12).val)} />;
}
