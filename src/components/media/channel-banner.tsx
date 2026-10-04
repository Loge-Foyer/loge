import type { Channel } from '@loge/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SizableText, Spinner, XStack, YStack } from 'tamagui';

import { px } from '@/components/density';
import { ChannelSummary } from '@/components/media/channel-row';
import { nowAndNext, useGuide, useNow } from '@/hooks/use-live';

/**
 * A live channel over its picture, on a TV: its logo or number, its name, what
 * is on now — when, how far along, what it is about — and what is next. It
 * comes in as a channel opens or the remote zaps, and goes by itself; the
 * controls come only with select. It never takes the remote's focus.
 */
export function ChannelBanner({ channel, waiting, reconnecting }: { channel: Channel; waiting: boolean; reconnecting: boolean }) {
  const insets = useSafeAreaInsets();
  const guide = useGuide(channel.key.connectionId, [channel.key]);
  const now = useNow();
  const { now: airing } = nowAndNext(guide.data?.value, channel.key, now);
  return (
    <YStack position="absolute" l={0} r={0} b={0} pointerEvents="none" pb={insets.bottom + px(32)} pl={insets.left + px(40)} pr={insets.right + px(40)}>
      <YStack bg="rgba(10, 10, 10, 0.84)" rounded="$6" p="$4" gap="$2" maxW={px(980)}>
        <XStack items="center" gap="$4">
          <ChannelSummary channel={channel} connectionId={channel.key.connectionId} programmes={guide.data?.value} now={now} favorite={false} />
          {waiting ? <Spinner size="large" color="white" /> : null}
        </XStack>
        {reconnecting ? (
          <SizableText size="$3" color="$color11">
            The stream stopped. Reconnecting…
          </SizableText>
        ) : airing?.description ? (
          <SizableText size="$3" color="$color11" numberOfLines={2}>
            {airing.description}
          </SizableText>
        ) : null}
      </YStack>
    </YStack>
  );
}
