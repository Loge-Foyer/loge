import type { Channel, GlobalMediaKey, Programme } from '@loge/api';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { Animated, Easing, FlatList, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SizableText, Spinner, XStack, YStack } from 'tamagui';

import { px } from '@/components/density';
import { ChannelSummary } from '@/components/media/channel-row';
import { isFavorites, liveHref } from '@/components/media/item-link';
import { isTV, useRemoteFocus } from '@/components/remote';
import { useBackToClose } from '@/hooks/use-back-to-close';
import { useFavoriteChannels } from '@/hooks/use-lists';
import { useChannelGroups, useGuide, useLineup, useNow } from '@/hooks/use-live';
import { useRemoteKeys } from '@/hooks/use-remote-keys';

/** Every row the same height, so the list opens on the channel playing without measuring the ones above it. */
const ROW = px(72);
const SLIDE_MS = 220;
/** How many pages are asked for, looking for the channel playing, before the list opens at its top instead. */
const PAGES_TO_FIND = 10;
/** The guide is asked for the channels around the one playing, as the TV tab asks for the ones near its top. */
const GUIDE_BEFORE = 10;
const GUIDE_AFTER = 30;

/**
 * A live channel's group, sliding in from the left over the picture while the
 * channel plays on: up and down move through it, and select zaps — the player
 * starts again on the new channel, and this goes with it. Right, Back, or a
 * tap beside it closes it.
 */
export function ChannelPanel({ channel, group, onClose }: { channel: GlobalMediaKey; group: string | undefined; onClose: () => void }) {
  const favorites = isFavorites(group);
  const lineup = useLineup(channel, group, favorites);
  const groups = useChannelGroups(favorites || !group ? undefined : channel.connectionId);
  const kept = useFavoriteChannels(channel.connectionId);
  const keptIds = new Set((kept.data ?? []).map((entry) => entry.externalId));
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(px(420), screen * 0.45) + insets.left;
  const title = favorites ? 'Favorites' : group ? (groups.data?.value.find((each) => each.id === group)?.name ?? '') : 'All channels';

  // Paged on until the channel playing turns up — for a while: past that, the
  // list opens at its top, and a big group's later pages wait for its end.
  const found = lineup.at >= 0;
  const ready = lineup.settled && (found || !lineup.more || lineup.pages >= PAGES_TO_FIND);
  const pageOn = useEffectEvent(() => lineup.loadMore());
  useEffect(() => {
    if (lineup.settled && !found && lineup.more && !lineup.fetchingMore && lineup.pages < PAGES_TO_FIND) pageOn();
  }, [lineup.settled, found, lineup.more, lineup.fetchingMore, lineup.pages]);

  const start = Math.max(0, lineup.at);
  const guide = useGuide(
    channel.connectionId,
    lineup.list.slice(Math.max(0, start - GUIDE_BEFORE), start + GUIDE_AFTER).map((each) => each.key),
  );
  const now = useNow();

  const [progress] = useState(() => new Animated.Value(0));
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: SLIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress]);
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    Animated.timing(progress, { toValue: 0, duration: SLIDE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  };
  useBackToClose(!leaving, close);
  useRemoteKeys((key) => {
    if (key === 'right') close();
  });

  const zap = (target: Channel) => {
    if (target.key.externalId === channel.externalId) return close();
    router.replace(liveHref(target.key, target.name, group));
  };

  return (
    <>
      {/* Beside the list, the picture: a tap there closes it. A remote never lands on it. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close the channels" {...(isTV ? { focusable: false } : {})} />
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width,
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }],
        }}
      >
        <YStack flex={1} bg="rgba(10, 10, 10, 0.94)" pl={insets.left} pt={insets.top + px(16)} pb={insets.bottom}>
          <SizableText size="$5" fontWeight="700" color="white" px="$4" pb="$3" numberOfLines={1}>
            {title}
          </SizableText>
          {!ready ? (
            <YStack py="$6" items="center">
              <Spinner size="large" color="white" />
            </YStack>
          ) : lineup.list.length === 0 ? (
            <SizableText color="rgba(255, 255, 255, 0.7)" px="$4">
              No channels here.
            </SizableText>
          ) : (
            <FlatList
              data={lineup.list}
              keyExtractor={(each) => each.key.externalId}
              getItemLayout={(_data, index) => ({ length: ROW, offset: ROW * index, index })}
              initialScrollIndex={start}
              onEndReachedThreshold={0.5}
              onEndReached={lineup.loadMore}
              renderItem={({ item, index }) => (
                <PanelChannel
                  channel={item}
                  current={item.key.externalId === channel.externalId}
                  preferred={index === start}
                  favorite={keptIds.has(item.key.externalId)}
                  programmes={guide.data?.value}
                  now={now}
                  onPress={() => zap(item)}
                />
              )}
            />
          )}
        </YStack>
      </Animated.View>
    </>
  );
}

/** One channel in the list: the one playing marked, the focused one lit; the remote's focus starts on the one playing. */
function PanelChannel({
  channel,
  current,
  preferred,
  favorite,
  programmes,
  now,
  onPress,
}: {
  channel: Channel;
  current: boolean;
  preferred: boolean;
  favorite: boolean;
  programmes: readonly Programme[] | undefined;
  now: number;
  onPress: () => void;
}) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={current ? `${channel.name}, playing` : `Watch ${channel.name}`}
      accessibilityState={{ selected: current }}
      style={{ height: ROW }}
      {...(isTV ? { hasTVPreferredFocus: preferred, ...handlers } : {})}
    >
      {({ pressed }) => (
        <XStack
          height={ROW}
          items="center"
          gap="$3"
          px="$3"
          overflow="hidden"
          opacity={pressed ? 0.75 : 1}
          bg={focused ? '$accent4' : current ? 'rgba(255, 255, 255, 0.08)' : 'transparent'}
          borderLeftWidth={3}
          borderLeftColor={current ? '$accent10' : 'transparent'}
        >
          <ChannelSummary channel={channel} connectionId={channel.key.connectionId} programmes={programmes} now={now} favorite={favorite} compact />
        </XStack>
      )}
    </Pressable>
  );
}
