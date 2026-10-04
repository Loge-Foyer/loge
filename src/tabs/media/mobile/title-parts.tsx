import type { Episode, MediaDetail, MediaItem, Show } from '@loge/api';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { CircleAlert } from '@tamagui/lucide-icons-2/icons/CircleAlert';
import { CircleCheck } from '@tamagui/lucide-icons-2/icons/CircleCheck';
import { Download } from '@tamagui/lucide-icons-2/icons/Download';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { Star } from '@tamagui/lucide-icons-2/icons/Star';
import { Link } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Pressable } from 'react-native';
import { Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { Button } from '@/components/button';
import { px } from '@/components/density';
import { formatCommunityRating } from '@/components/labels';
import { BoxBadge, progressOf, ProgressBar, WatchedBadge } from '@/components/media/badges';
import { titleHref } from '@/components/media/item-link';
import { PosterCard } from '@/components/media/poster-card';
import { TitleMenu } from '@/components/media/title-menu';
import { OverlayPicker } from '@/components/overlay-picker';
import { useDownloadActions, useDownloadBudget, useDownloadOf } from '@/hooks/use-downloads';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useChildren, useMoreLikeThis } from '@/hooks/use-media';

import { creditsOf, episodeLength, factsOf, qualityOf, seasonToOpen } from '../shared/title-meta';

const isEpisode = (item: MediaItem): item is Episode => item.type === 'episode';

/** The line under the title: its score, its years or year, its age rating, how long it runs or its seasons, how it looks. */
export function MetaLine({ detail }: { detail: MediaDetail }) {
  const { item } = detail;
  const quality = qualityOf(detail.versions);
  return (
    <XStack gap="$2.5" items="center" flexWrap="wrap">
      {item.ratings.community === undefined ? null : (
        <XStack gap="$1" items="center">
          <Star size={px(13)} color="$yellow10" fill="currentColor" />
          <SizableText size="$3" fontWeight="600" color="$color12">
            {formatCommunityRating(item.ratings.community)}
          </SizableText>
        </XStack>
      )}
      {item.ratings.critic === undefined ? null : (
        <SizableText size="$3" fontWeight="600" color="$green11">
          {`${item.ratings.critic}%`}
        </SizableText>
      )}
      {factsOf(item).map((fact) => (
        <SizableText key={fact} size="$3" color="$color11">
          {fact}
        </SizableText>
      ))}
      {item.contentRating ? <BoxBadge label={item.contentRating} filled /> : null}
      {quality ? <BoxBadge label={quality} /> : null}
    </XStack>
  );
}

/** Who is in it and who made it, in grey: a line each, the cast cut short until "more" is pressed. */
export function Credits({ detail }: { detail: MediaDetail }) {
  const [all, setAll] = useState(false);
  const { cast, makers, makersLabel } = creditsOf(detail.people);
  if (cast.length === 0 && makers.length === 0) return null;
  const shown = all ? cast : cast.slice(0, 3);
  return (
    <YStack gap="$1">
      {cast.length > 0 ? (
        <SizableText size="$2" color="$color10" {...(all ? {} : { numberOfLines: 1 })}>
          {`Cast: ${shown.join(', ')}`}
          {!all && cast.length > shown.length ? (
            <SizableText size="$2" fontWeight="700" color="$color11" onPress={() => setAll(true)} aria-label="More of the cast">
              {'  … more'}
            </SizableText>
          ) : null}
        </SizableText>
      ) : null}
      {makers.length > 0 ? (
        <SizableText size="$2" color="$color10" numberOfLines={1}>
          {`${makersLabel}: ${makers.join(', ')}`}
        </SizableText>
      ) : null}
    </YStack>
  );
}

/**
 * Keep a copy, full width, and say where it has got to. Where the source
 * offers versions it opens the page of them; where it does not, one press
 * takes whatever the source hands over.
 */
export function DownloadButton({ item, onChoose }: { item: MediaItem; onChoose: (() => void) | undefined }) {
  const { data: entry } = useDownloadOf(item.key);
  const { data: budget } = useDownloadBudget();
  const { start, remove } = useDownloadActions();
  const percent =
    entry && entry.bytesTotal !== undefined && entry.bytesTotal > 0 ? Math.round((entry.bytesDone / entry.bytesTotal) * 100) : undefined;
  const [label, icon, onPress]: [string, ReactElement, (() => void) | undefined] =
    entry?.state === 'done'
      ? ['Delete download', <CircleCheck key="done" size={px(18)} color="$green10" />, () => remove.mutate(entry.id)]
      : entry?.state === 'failed'
        ? ['Download failed', <CircleAlert key="failed" size={px(18)} color="$red10" />, undefined]
        : entry
          ? [percent === undefined ? 'Downloading' : `Downloading ${percent} %`, <Spinner key="busy" size="small" color="$color11" />, undefined]
          : budget?.full
            ? ['No room left to download', <Download key="full" size={px(18)} color="$color10" />, undefined]
            : ['Download', <Download key="go" size={px(18)} color="$color12" />, onChoose ?? (() => start.mutate({ item }))];
  return (
    <Button size="$4" bg="$color4" borderWidth={0} icon={icon} disabled={onPress === undefined} onPress={onPress}>
      {label}
    </Button>
  );
}

/** One of a title's icon buttons: its symbol above its word. */
export function IconAction({ icon, label, onPress, disabled = false }: { icon: ReactElement; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      {({ pressed }) => (
        <YStack items="center" gap="$1.5" minW={px(64)} opacity={disabled ? 0.5 : pressed ? 0.6 : 1}>
          {icon}
          <SizableText size="$1" fontWeight="600" color="$color11" numberOfLines={1}>
            {label}
          </SizableText>
        </YStack>
      )}
    </Pressable>
  );
}

/** "Episodes" and "More like this" as tabs, the chosen one marked with the accent along its top. */
export function SheetTabs<T extends string>({ tabs, chosen, onChoose }: { tabs: readonly { id: T; label: string }[]; chosen: T; onChoose: (id: T) => void }) {
  return (
    <XStack gap="$5" borderTopWidth={1} borderColor="$color4">
      {tabs.map((tab) => {
        const on = tab.id === chosen;
        return (
          <Pressable key={tab.id} onPress={() => onChoose(tab.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <YStack position="relative" pt="$3">
              <YStack position="absolute" t={-2} l={0} r={0} height={3} rounded={2} bg={on ? '$accentBackground' : 'transparent'} />
              <SizableText size="$5" fontWeight="700" color={on ? '$color12' : '$color10'}>
                {tab.label}
              </SizableText>
            </YStack>
          </Pressable>
        );
      })}
    </XStack>
  );
}

/**
 * A series' episodes, a season at a time: "Season 1 ▾" opens the seasons over
 * everything, and each episode is its still — which plays it, from where it
 * stopped — its number and name, which open its own sheet, and what it is
 * about.
 */
export function Episodes({
  show,
  initial,
  width,
  showWatch,
  canPlay,
  keepable,
  offersChoices,
  onPlay,
}: {
  show: Show;
  initial: string | undefined;
  width: number;
  showWatch: boolean;
  canPlay: boolean;
  keepable: (item: MediaItem) => boolean;
  offersChoices: boolean;
  onPlay: (episode: Episode) => void;
}) {
  const seasons = useChildren(show);
  const list = seasons.data?.items ?? [];
  const [chosen, setChosen] = useState(initial);
  const [picking, setPicking] = useState(false);
  const season = seasonToOpen(list, chosen);
  const episodes = useChildren(season);
  const withKept = useKeptWatch(episodes.data?.items ?? []);
  if (seasons.isPending) return <Spinner color="$accent9" self="flex-start" />;
  if (list.length === 0) return null;
  return (
    <YStack gap="$4">
      <Button
        size="$3"
        self="flex-start"
        bg="$color3"
        borderWidth={0}
        iconAfter={<ChevronDown size={px(16)} color="$color11" />}
        aria-label={`${season?.title ?? 'Season'}, choose another`}
        onPress={() => setPicking(true)}
      >
        {season?.title ?? 'Season'}
      </Button>
      {episodes.isPending ? <Spinner color="$accent9" self="flex-start" /> : null}
      {(episodes.data?.items ?? [])
        .map(withKept)
        .filter(isEpisode)
        .map((episode) => (
          <EpisodeRow
            key={episode.key.externalId}
            episode={episode}
            width={width}
            showWatch={showWatch}
            canPlay={canPlay}
            keepable={keepable(episode)}
            offersChoices={offersChoices}
            onPlay={() => onPlay(episode)}
          />
        ))}
      <OverlayPicker
        open={picking}
        label="Seasons"
        options={list.map((each) => ({ id: each.key.externalId, label: each.title }))}
        selected={season?.key.externalId}
        onSelect={setChosen}
        onClose={() => setPicking(false)}
      />
    </YStack>
  );
}

function EpisodeRow({
  episode,
  width,
  showWatch,
  canPlay,
  keepable,
  offersChoices,
  onPlay,
}: {
  episode: Episode;
  width: number;
  showWatch: boolean;
  canPlay: boolean;
  keepable: boolean;
  offersChoices: boolean;
  onPlay: () => void;
}) {
  const progress = showWatch ? progressOf(episode) : undefined;
  const still = Math.round(width * 0.4);
  const length = episodeLength(episode);
  return (
    <YStack gap="$2">
      <XStack gap="$3" items="center">
        <Pressable onPress={canPlay ? onPlay : undefined} disabled={!canPlay} accessibilityRole="button" accessibilityLabel={`Play ${episode.title}`}>
          {({ pressed }) => (
            <YStack position="relative" opacity={pressed ? 0.8 : 1}>
              <Artwork connectionId={episode.key.connectionId} image={episode.images.thumb ?? episode.images.backdrop} width={still} aspect={16 / 9} label={episode.title} rounded="$4" />
              {canPlay ? (
                <YStack position="absolute" t={0} l={0} r={0} b={0} items="center" justify="center" pointerEvents="none">
                  <YStack width={px(34)} height={px(34)} rounded={999} bg="rgba(0,0,0,0.55)" borderWidth={1} borderColor="rgba(255,255,255,0.8)" items="center" justify="center">
                    <Play size={px(14)} color="white" fill="white" />
                  </YStack>
                </YStack>
              ) : null}
              {showWatch && episode.watch?.played ? <WatchedBadge /> : null}
              {progress === undefined ? null : <ProgressBar value={progress} />}
            </YStack>
          )}
        </Pressable>
        <Link href={titleHref(episode)} asChild>
          <Pressable style={{ flex: 1 }} accessibilityRole="link" accessibilityLabel={episode.title}>
            <YStack gap="$1">
              <SizableText size="$4" color="$color12" numberOfLines={2}>
                {episode.episodeNumber === undefined ? episode.title : `${episode.episodeNumber}. ${episode.title}`}
              </SizableText>
              {length ? (
                <SizableText size="$2" color="$color10">
                  {length}
                </SizableText>
              ) : null}
            </YStack>
          </Pressable>
        </Link>
        {keepable ? <EpisodeDownload episode={episode} offersChoices={offersChoices} /> : null}
      </XStack>
      {episode.overview ? (
        <Paragraph size="$2" color="$color10" numberOfLines={3}>
          {episode.overview}
        </Paragraph>
      ) : null}
    </YStack>
  );
}

/** An episode's own copy: its symbol, or how far it has got. */
function EpisodeDownload({ episode, offersChoices }: { episode: Episode; offersChoices: boolean }) {
  const { data: entry } = useDownloadOf(episode.key);
  const { data: budget } = useDownloadBudget();
  const { start } = useDownloadActions();
  const [choosing, setChoosing] = useState(false);
  if (entry?.state === 'done') return <CircleCheck size={px(20)} color="$green10" aria-label="Downloaded" />;
  if (entry?.state === 'failed') return <CircleAlert size={px(20)} color="$red10" aria-label="Download failed" />;
  if (entry) {
    const percent = entry.bytesTotal ? Math.round((entry.bytesDone / entry.bytesTotal) * 100) : undefined;
    return (
      <SizableText size="$1" color="$color10">
        {percent === undefined ? '…' : `${percent} %`}
      </SizableText>
    );
  }
  return (
    <>
      <Button
        size="$3"
        circular
        chromeless
        disabled={budget?.full ?? false}
        icon={<Download size={px(20)} color="$color11" />}
        aria-label={`Download ${episode.title}`}
        onPress={() => (offersChoices ? setChoosing(true) : start.mutate({ item: episode }))}
      />
      {offersChoices ? (
        <TitleMenu
          item={episode}
          open={choosing}
          onClose={() => setChoosing(false)}
          players={[]}
          canList={false}
          keepable
          offersChoices
          onPlayWith={() => undefined}
          initialPage="download"
        />
      ) : null}
    </>
  );
}

/** Titles like this one — its first genre, the best rated first — as posters, three across. */
export function MoreLikeThis({ item, width, showWatch }: { item: MediaItem; width: number; showWatch: boolean }) {
  const like = useMoreLikeThis(item);
  const items = like.data?.items ?? [];
  const gap = px(8);
  const cardWidth = Math.floor((width - 2 * gap) / 3);
  if (like.isPending) return <Spinner color="$accent9" self="flex-start" />;
  if (items.length === 0) {
    return (
      <SizableText size="$3" color="$color10">
        {item.genres.length === 0 ? 'This title names no genre to find others by.' : 'Nothing else here is like it yet.'}
      </SizableText>
    );
  }
  return (
    <XStack flexWrap="wrap" gap={gap}>
      {items.map((other) => (
        <PosterCard key={`${other.key.connectionId}|${other.key.externalId}`} item={other} width={cardWidth} showWatch={showWatch} href={titleHref(other)} words={false} />
      ))}
    </XStack>
  );
}
