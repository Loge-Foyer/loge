import type { Episode, GlobalMediaKey, MediaDetail, MediaItem, Show } from '@loge/api';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { CirclePlay } from '@tamagui/lucide-icons-2/icons/CirclePlay';
import { Eye } from '@tamagui/lucide-icons-2/icons/Eye';
import { FileVideo } from '@tamagui/lucide-icons-2/icons/FileVideo';
import { ListPlus } from '@tamagui/lucide-icons-2/icons/ListPlus';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { Link, router, Stack, useNavigation } from 'expo-router';
import { useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { H2, Paragraph, SizableText, Spinner, Theme, useTheme, XStack, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { CastButton } from '@/components/cast-button';
import { px } from '@/components/density';
import { HeaderButton } from '@/components/header-button';
import { EyeFilled } from '@/components/icons';
import { episodeCode } from '@/components/labels';
import { progressOf, ProgressBar } from '@/components/media/badges';
import { routeId, titleKeyHref } from '@/components/media/item-link';
import { SourceNotices } from '@/components/media/source-notices';
import { TitleMenu, type TitleMenuPage } from '@/components/media/title-menu';
import { PrimaryButton } from '@/components/primary-button';
import { Scrim } from '@/components/scrim';
import { titleHasOwnStack } from '@/components/stack-options';
import { useRefreshMedia } from '@/hooks/use-media';

import { resumeAtOf, useTitleActions } from '../shared/title-actions';
import { useTitle } from '../shared/title-data';
import { useUpNext } from '../shared/up-next';
import { Credits, DownloadButton, Episodes, IconAction, MetaLine, MoreLikeThis, SheetTabs } from './title-parts';

const INSET = px(16);
// The bar the ✕ floats in where the sheet has no header of its own.
const BAR = px(56);

type Tab = 'episodes' | 'like';

/**
 * A title's sheet: it rises to the top of the safe area and closes on its ✕
 * or a slide down. Its picture, its name and facts, Play — Resume where it
 * stopped — Download where a copy can be kept, what it is about and who is in
 * it, its icon buttons, and for a series its episodes beside "More like this".
 *
 * It is one scroll view with nothing beside it, and every modal it opens is
 * drawn inside it: an iOS sheet stretches a scroll view that is not the second
 * of exactly two children over the whole sheet. On an iPhone its ✕ sits in
 * the sheet's own native header, in the system's glass; elsewhere it floats
 * in a sticky bar at the top of the scroll view.
 */
export function TitleSheet({ itemKey, season }: { itemKey: GlobalMediaKey; season?: string }) {
  const title = useTitle(itemKey);
  const close = useCloseSheet();
  const { width: windowWidth } = useWindowDimensions();
  // An iPad shows the sheet in the middle of the screen, narrower than the window.
  const [width, setWidth] = useState(windowWidth);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const buttons = (inHeader: boolean) => (
    <XStack gap="$2" items="center">
      <CastButton variant="floating" inHeader={inHeader} />
      <HeaderButton icon={X} label="Close" inHeader={inHeader} onPress={close} />
    </XStack>
  );

  // The scroll view is the page itself, with nothing round it: an iOS form sheet sizes only a scroll
  // view that sits straight in it, and a view round it was left no height — the sheet came up blank.
  return (
    <>
      {titleHasOwnStack ? <Stack.Screen options={{ headerRight: () => buttons(true) }} /> : null}
      <ScrollView
        style={{ flex: 1, backgroundColor: String(theme.background.val) }}
        contentInsetAdjustmentBehavior="never"
        // Android's sheet hands a drag to what scrolls inside it only where nested scrolling is on.
        nestedScrollEnabled
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        contentContainerStyle={{ paddingBottom: insets.bottom + px(40) }}
        {...(titleHasOwnStack ? {} : { stickyHeaderIndices: [0] })}
      >
        {titleHasOwnStack ? null : (
          <XStack height={BAR} justify="flex-end" items="center" px="$3" pointerEvents="box-none">
            {buttons(false)}
          </XStack>
        )}
        {title.detail ? (
          <YStack mt={titleHasOwnStack ? 0 : -BAR}>
            <Body
              detail={title.detail}
              width={width}
              title={title}
              season={season}
              {...(title.sourceError ? { sourceError: title.sourceError } : {})}
            />
          </YStack>
        ) : title.isPending ? (
          <Spinner size="large" color="$accent9" mt="$12" />
        ) : (
          <SizableText color="$color10" p={INSET} pt={px(72)}>
            {title.error?.message ?? 'This title could not be opened.'}
          </SizableText>
        )}
      </ScrollView>
    </>
  );
}

/** Closes the whole sheet — from a title opened inside it too, where it has a stack of its own. */
function useCloseSheet() {
  const navigation = useNavigation();
  return () => {
    const sheet = titleHasOwnStack ? navigation.getParent() : undefined;
    if (sheet?.canGoBack()) sheet.goBack();
    else if (router.canGoBack()) router.back();
    else router.replace('/media');
  };
}

function Body({
  detail,
  width,
  title,
  season,
  sourceError,
}: {
  detail: MediaDetail;
  width: number;
  title: ReturnType<typeof useTitle>;
  season: string | undefined;
  sourceError?: NonNullable<ReturnType<typeof useTitle>['sourceError']>;
}) {
  const { item } = detail;
  const refresh = useRefreshMedia();
  const { play, mark } = useTitleActions(item);
  const upNext = useUpNext(item.type === 'show' ? (item as Show) : undefined);
  const [menu, setMenu] = useState<TitleMenuPage>();
  const [tab, setTab] = useState<Tab>(item.type === 'show' ? 'episodes' : 'like');
  const playing: MediaItem | undefined = item.type === 'show' ? upNext : item.type === 'movie' || item.type === 'episode' ? item : undefined;
  const resumeAt = resumeAtOf(playing);
  const played = item.watch?.played ?? false;
  const playable = title.canPlay && playing !== undefined;
  const keepable = title.keepable(item);
  const choosesPlayer = playable && title.players.length > 1;
  const inner = width - 2 * INSET;

  return (
    <YStack>
      <Hero item={item} width={width} />
      <YStack px={INSET} pt="$3" gap="$3.5">
        {sourceError ? <SourceNotices errors={[sourceError]} onRetry={() => void refresh()} /> : null}
        {item.type === 'episode' ? <EpisodeOf episode={item} /> : null}
        <H2 size="$8" color="$color12">
          {item.title}
        </H2>
        <MetaLine detail={detail} />
        {playable && playing ? (
          <PrimaryButton size="$4" icon={<Play size={px(18)} fill="currentColor" />} onPress={() => play(playing)}>
            {playLabel(item, playing, resumeAt)}
          </PrimaryButton>
        ) : null}
        {keepable ? <DownloadButton item={item} onChoose={title.offersChoices ? () => setMenu('download') : undefined} /> : null}
        {item.overview ? (
          <Paragraph size="$4" color="$color12">
            {item.overview}
          </Paragraph>
        ) : null}
        <Credits detail={detail} />
        <XStack justify="space-around" pt="$2">
          {playable ? <IconAction icon={<ListPlus size={px(24)} color="$color12" />} label="My list" onPress={() => setMenu('lists')} /> : null}
          {title.canMarkWatched ? (
            <IconAction
              icon={played ? <EyeFilled size={px(24)} color="$color12" /> : <Eye size={px(24)} color="$color12" />}
              label={played ? 'Watched' : 'Unwatched'}
              disabled={mark.isPending}
              onPress={() => mark.mutate(!played)}
            />
          ) : null}
          {playable && playing && resumeAt !== undefined ? (
            <IconAction icon={<RotateCcw size={px(24)} color="$color12" />} label="Restart" onPress={() => play(playing, { fromStart: true })} />
          ) : null}
          {choosesPlayer ? <IconAction icon={<CirclePlay size={px(24)} color="$color12" />} label="Play with…" onPress={() => setMenu('players')} /> : null}
          {detail.versions && detail.versions.length > 0 ? (
            <IconAction
              icon={<FileVideo size={px(24)} color="$color12" />}
              label="File"
              onPress={() =>
                router.push({ pathname: '/media-info/[connectionId]/[itemId]', params: { connectionId: item.key.connectionId, itemId: routeId(item.key.externalId) } })
              }
            />
          ) : null}
        </XStack>
        {item.type === 'show' || item.type === 'movie' ? (
          <YStack gap="$4" pt="$3">
            <SheetTabs
              tabs={item.type === 'show' ? [{ id: 'episodes', label: 'Episodes' }, { id: 'like', label: 'More like this' }] : [{ id: 'like', label: 'More like this' }]}
              chosen={tab}
              onChoose={setTab}
            />
            {item.type === 'show' && tab === 'episodes' ? (
              <Episodes
                show={item}
                initial={season}
                width={inner}
                showWatch={title.showWatch}
                canPlay={title.canPlay}
                keepable={title.keepable}
                offersChoices={title.offersChoices}
                onPlay={(episode: Episode) => play(episode)}
              />
            ) : (
              <MoreLikeThis item={item} width={inner} showWatch={title.showWatch} />
            )}
          </YStack>
        ) : null}
      </YStack>
      {menu ? (
        <TitleMenu
          key={menu}
          item={playing ?? item}
          open
          onClose={() => setMenu(undefined)}
          players={title.players}
          canList={playable}
          keepable={keepable}
          offersChoices={title.offersChoices}
          onPlayWith={(player) => {
            if (playing) play(playing, { player });
          }}
          initialPage={menu}
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

/** The picture at the top, under the ✕ — a scene, or an episode's still — with how far it got. */
function Hero({ item, width }: { item: MediaItem; width: number }) {
  const image = item.type === 'episode' ? (item.images.thumb ?? item.images.backdrop) : (item.images.backdrop ?? item.images.thumb ?? item.images.poster);
  const progress = progressOf(item);
  return (
    <YStack position="relative" width={width}>
      <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={16 / 9} label={item.title} rounded="$0" />
      <Theme name="dark">
        <Scrim from="top" strength={0.3} />
      </Theme>
      {progress === undefined ? null : <ProgressBar value={progress} />}
    </YStack>
  );
}

/** An episode's series and its place in it, opening the series. */
function EpisodeOf({ episode }: { episode: Episode }) {
  return (
    <Link href={titleKeyHref(episode.show)} asChild>
      <XStack gap="$1" items="center" self="flex-start" role="link" aria-label={`All episodes of ${episode.showTitle}`}>
        <SizableText size="$3" fontWeight="600" color="$color11">
          {[episode.showTitle, episodeCode(episode)].filter(Boolean).join(' · ')}
        </SizableText>
        <ChevronRight size={px(16)} color="$color11" />
      </XStack>
    </Link>
  );
}
