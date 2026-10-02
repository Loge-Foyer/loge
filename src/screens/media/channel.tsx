import type { ChildSection, MediaDetail, MediaItem, VideoChannel, VideoPlaylist } from '@sc/api';
import { FlashList } from '@shopify/flash-list';
import { UserCheck } from '@tamagui/lucide-icons-2/icons/UserCheck';
import { UserPlus } from '@tamagui/lucide-icons-2/icons/UserPlus';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { H1, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { ActionButton } from '@/components/action-button';
import { Artwork } from '@/components/artwork';
import { px } from '@/components/density';
import { followersLabel, videoCountLabel } from '@/components/labels';
import { ChannelCard } from '@/components/media/channel-card';
import { keyHref } from '@/components/media/item-link';
import { LandscapeCard } from '@/components/media/landscape-card';
import { SourceNotices } from '@/components/media/source-notices';
import { isTV, useRemoteFocus } from '@/components/remote';
import { Scrim } from '@/components/scrim';
import { useLandscapeWidth } from '@/components/shelf';
import { SourceTabs } from '@/components/source-tabs';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useFollows, useListActions } from '@/hooks/use-lists';
import { useChildPages, useRefreshMedia } from '@/hooks/use-media';
import type { SourceError } from '@/services/media';

const PADDING = 16;
const GAP = 12;

/**
 * A channel's page — its banner and face, how many follow it, what it says
 * about itself, Follow, and what it holds a section at a time — or a
 * playlist's, its videos in its own order. One scrolling grid, the page its
 * header, paging on for as long as the source has more.
 */
export function CollectionPage({
  detail,
  showWatch,
  canFollow,
  sourceError,
}: {
  detail: MediaDetail & { readonly item: VideoChannel | VideoPlaylist };
  showWatch: boolean;
  /** The source brings a feed, so following a channel means something. */
  canFollow: boolean;
  sourceError?: SourceError;
}) {
  const { item } = detail;
  const sections = detail.sections ?? [];
  const [chosen, setChosen] = useState(sections[0]?.id);
  const section = sections.find((each) => each.id === chosen)?.id ?? sections[0]?.id;
  const pages = useChildPages(item, section);
  const children = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const withKept = useKeptWatch(children);
  const refresh = useRefreshMedia();
  const { width } = useWindowDimensions();
  const cardTarget = useLandscapeWidth();
  const columns = Math.min(12, Math.max(1, Math.floor((width - 2 * PADDING + GAP) / (cardTarget + GAP))));
  const cardWidth = Math.floor((width - 2 * PADDING - (columns - 1) * GAP) / columns);

  return (
    <FlashList
      // A new column count is a new layout; a new section, a new list.
      key={`${columns}:${section ?? ''}`}
      data={children}
      numColumns={columns}
      keyExtractor={(child: MediaItem) => child.key.externalId}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: PADDING - GAP / 2, paddingBottom: 48 }}
      ListHeaderComponent={
        <YStack gap="$4" pb="$4">
          {item.type === 'channel' ? <ChannelHeader channel={item} width={width} /> : <PlaylistHeader playlist={item} width={width} />}
          <YStack px={GAP / 2} gap="$4">
            {sourceError ? <SourceNotices errors={[sourceError]} onRetry={() => void refresh()} /> : null}
            {item.overview ? <About text={item.overview} /> : null}
            {item.type === 'channel' && canFollow ? (
              <XStack>
                <FollowButton channel={item} />
              </XStack>
            ) : null}
            {sections.length > 1 ? <Sections sections={sections} selected={section ?? ''} onSelect={setChosen} /> : null}
          </YStack>
        </YStack>
      }
      renderItem={({ item: child }: { item: MediaItem }) => (
        <YStack px={GAP / 2} pb="$5" items="center">
          {child.type === 'channel' ? <ChannelCard item={child} width={cardWidth} /> : <LandscapeCard item={withKept(child)} width={cardWidth} showWatch={showWatch} />}
        </YStack>
      )}
      ListEmptyComponent={
        pages.isPending ? (
          <YStack py="$8" items="center">
            <Spinner size="large" color="$accent9" />
          </YStack>
        ) : (
          <SizableText px={GAP / 2} color="$color10">
            {pages.error ? pages.error.message : 'Nothing here yet.'}
          </SizableText>
        )
      }
      ListFooterComponent={pages.isFetchingNextPage ? <Spinner color="$accent9" my="$5" /> : null}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
      }}
    />
  );
}

/** The banner across the top, the face over its foot, the name and how many follow. */
function ChannelHeader({ channel, width }: { channel: VideoChannel; width: number }) {
  const top = useHeaderRoom();
  const face = px(88);
  const bannerHeight = Math.max(px(120), Math.round(width / 4));
  const facts = [
    channel.followers === undefined ? undefined : followersLabel(channel.followers),
    channel.videoCount === undefined ? undefined : videoCountLabel(channel.videoCount),
  ].filter(Boolean);
  return (
    <YStack>
      {channel.images.backdrop ? (
        <YStack position="relative" width={width} height={bannerHeight} bg="$color2">
          <Artwork connectionId={channel.key.connectionId} image={channel.images.backdrop} width={width} aspect={width / bannerHeight} label={channel.title} rounded="$0" />
          <Scrim from="top" strength={0.35} />
        </YStack>
      ) : (
        <YStack height={top} />
      )}
      <XStack px={PADDING} gap="$3" items="flex-end" mt={channel.images.backdrop ? -face / 2 : 0}>
        <YStack rounded={999} borderWidth={3} borderColor="$background" bg="$background">
          <Artwork connectionId={channel.key.connectionId} image={channel.images.avatar} width={face} aspect={1} label={channel.title} rounded={999} />
        </YStack>
        <YStack flex={1} pb="$1" gap="$1">
          <H1 size="$8" color="$color12" numberOfLines={2}>
            {channel.title}
          </H1>
          {facts.length > 0 ? (
            <SizableText size="$3" color="$color11">
              {facts.join('  ·  ')}
            </SizableText>
          ) : null}
        </YStack>
      </XStack>
    </YStack>
  );
}

/** Its picture, its name, how much is in it, and whose list it is. */
function PlaylistHeader({ playlist, width }: { playlist: VideoPlaylist; width: number }) {
  const height = Math.round(width / (16 / 9));
  const owner = playlist.owner;
  return (
    <YStack gap="$3">
      <YStack position="relative" width={width} height={height} bg="$color2">
        <Artwork connectionId={playlist.key.connectionId} image={playlist.images.backdrop ?? playlist.images.thumb} width={width} aspect={16 / 9} label={playlist.title} rounded="$0" />
        <Scrim from="top" strength={0.35} />
        <Scrim from="bottom" />
        <YStack position="absolute" l={PADDING} r={PADDING} b="$4">
          <H1 size="$9" color="$color12" numberOfLines={3}>
            {playlist.title}
          </H1>
        </YStack>
      </YStack>
      <XStack px={PADDING} gap="$2" items="center" flexWrap="wrap">
        {playlist.videoCount === undefined ? null : (
          <SizableText size="$3" color="$color11">
            {videoCountLabel(playlist.videoCount)}
          </SizableText>
        )}
        {owner ? <OwnerLink owner={owner} /> : null}
      </XStack>
    </YStack>
  );
}

/** Whose list it is, opening that channel. */
function OwnerLink({ owner }: { owner: NonNullable<VideoPlaylist['owner']> }) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Link href={keyHref(owner.key)} asChild>
      <Pressable accessibilityRole="link" {...handlers}>
        <SizableText size="$3" color="$accent11" fontWeight="600" textDecorationLine={focused ? 'underline' : 'none'}>
          {owner.name}
        </SizableText>
      </Pressable>
    </Link>
  );
}

/** What it says about itself: three lines, then the rest on asking. */
function About({ text }: { text: string }) {
  const [whole, setWhole] = useState(false);
  const { focused, handlers } = useRemoteFocus();
  return (
    <Pressable onPress={() => setWhole(!whole)} accessibilityRole="button" accessibilityHint={whole ? 'Shows less' : 'Shows all of it'} {...handlers}>
      <YStack gap="$1">
        <Paragraph size="$3" color="$color11" {...(whole ? {} : { numberOfLines: 3 })}>
          {text}
        </Paragraph>
        <SizableText size="$2" color={focused ? '$accent11' : '$color10'} fontWeight="600">
          {whole ? 'Less' : 'More'}
        </SizableText>
      </YStack>
    </Pressable>
  );
}

function Sections({ sections, selected, onSelect }: { sections: readonly ChildSection[]; selected: string; onSelect: (id: string) => void }) {
  return <SourceTabs tabs={sections.map((section) => ({ id: section.id, label: section.label }))} selected={selected} onSelect={onSelect} />;
}

/** Follow a channel, so its newest reaches this profile's feed. */
export function FollowButton({ channel }: { channel: MediaItem }) {
  const { data: following } = useFollows(channel.key.connectionId, channel.key.externalId);
  const { follow, unfollow } = useListActions();
  const busy = follow.isPending || unfollow.isPending;
  return following ? (
    <ActionButton icon={<UserCheck size={18} />} label="Following" disabled={busy} onPress={() => unfollow.mutate(following.id)} />
  ) : (
    <ActionButton icon={<UserPlus size={18} />} label="Follow" disabled={busy} onPress={() => follow.mutate(channel)} />
  );
}

/** Room for the header that floats over a page with no picture at its top. A TV has no header. */
function useHeaderRoom(): number {
  const insets = useSafeAreaInsets();
  return isTV ? px(40) : insets.top + px(56);
}
