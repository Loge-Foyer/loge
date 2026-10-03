import type { Channel, ConnectionId, Programme } from '@loge/api';
import { Star } from '@tamagui/lucide-icons-2/icons/Star';
import { SizableText, XStack, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { px } from '@/components/density';
import { clockOf } from '@/components/labels';
import { nowAndNext } from '@/hooks/use-live';

/**
 * A channel at a glance: its logo or number, its name — with a ★ when it is
 * one of the profile's favourites — what is on now and how far along, and
 * what is next. The TV tab's rows and the player's list of channels both draw
 * it, each inside its own row; `compact` leaves out what is next.
 */
export function ChannelSummary({
  channel,
  connectionId,
  programmes,
  now: at,
  favorite,
  compact = false,
}: {
  channel: Channel;
  connectionId: ConnectionId;
  programmes: readonly Programme[] | undefined;
  now: number;
  favorite: boolean;
  compact?: boolean;
}) {
  const { now, next } = nowAndNext(programmes, channel.key, at);
  const progress = now ? (at - Date.parse(now.startsAt)) / (Date.parse(now.endsAt) - Date.parse(now.startsAt)) : undefined;
  return (
    <>
      <YStack width={px(72)} height={px(42)} rounded="$2" overflow="hidden" bg="$color3" items="center" justify="center">
        {channel.logo ? (
          <Artwork connectionId={connectionId} image={channel.logo} width={px(72)} aspect={72 / 42} label={channel.name} rounded="$3" fit="contain" />
        ) : (
          <SizableText size="$4" fontWeight="700" color="$color10">
            {channel.number ?? channel.name.slice(0, 2)}
          </SizableText>
        )}
      </YStack>
      <YStack flex={1} gap="$1">
        <XStack items="center" gap="$1.5">
          <SizableText size="$4" fontWeight="600" color="$color12" numberOfLines={1} shrink={1}>
            {channel.number === undefined ? channel.name : `${channel.number}  ${channel.name}`}
          </SizableText>
          {favorite ? <Star size={px(13)} color="$accent10" /> : null}
        </XStack>
        {now ? (
          <YStack gap="$1">
            <SizableText size="$2" color="$color11" numberOfLines={1}>
              {`${clockOf(now.startsAt)}  ${now.title}`}
            </SizableText>
            <YStack height={3} rounded={2} bg="$color4" overflow="hidden">
              <YStack height="100%" width={`${Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)}%`} bg="$accent9" />
            </YStack>
          </YStack>
        ) : null}
        {next && !compact ? (
          <SizableText size="$1" color="$color10" numberOfLines={1}>
            {`Next ${clockOf(next.startsAt)}  ${next.title}`}
          </SizableText>
        ) : null}
      </YStack>
    </>
  );
}
