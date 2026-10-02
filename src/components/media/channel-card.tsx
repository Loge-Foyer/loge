import type { VideoChannel } from '@loge/api';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { SizableText, YStack } from 'tamagui';

import { Artwork } from '@/components/artwork';
import { followersLabel } from '@/components/labels';
import { CARD_FOCUSED, useRemoteFocus } from '@/components/remote';

import { itemHref } from './item-link';

/**
 * A channel among videos: its face, round, in a video's 16:9 place — so a grid
 * that mixes them keeps its rows — then its name and how many follow it.
 */
export function ChannelCard({ item, width, preferred = false }: { item: VideoChannel; width: number; preferred?: boolean }) {
  const { focused, handlers } = useRemoteFocus();
  const face = Math.round((width * 9) / 16 * 0.8);
  const facts = item.followers === undefined ? '' : followersLabel(item.followers);
  return (
    <Link href={itemHref(item)} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={facts ? `${item.title}, ${facts}` : item.title} hasTVPreferredFocus={preferred} {...handlers}>
        {({ pressed }) => (
          <YStack width={width} gap="$1.5" opacity={pressed ? 0.8 : 1}>
            <YStack height={Math.round((width * 9) / 16)} items="center" justify="center" rounded="$4" bg="$color2" {...(focused ? CARD_FOCUSED : {})}>
              <Artwork connectionId={item.key.connectionId} image={item.images.avatar} width={face} aspect={1} label={item.title} rounded={999} />
            </YStack>
            <YStack gap="$0.5">
              <SizableText size="$3" color={focused ? '$accent11' : '$color12'} numberOfLines={1}>
                {item.title}
              </SizableText>
              <SizableText size="$2" color="$color10" numberOfLines={1}>
                {facts || ' '}
              </SizableText>
            </YStack>
          </YStack>
        )}
      </Pressable>
    </Link>
  );
}
