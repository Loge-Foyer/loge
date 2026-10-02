import type { GlobalMediaKey } from '@loge/api';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList } from 'react-native';
import { Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { liveHref } from '@/components/media/item-link';
import { SourceNotices } from '@/components/media/source-notices';
import { PrimaryButton } from '@/components/primary-button';
import { useGuide, useNow } from '@/hooks/use-live';
import { useRefreshMedia } from '@/hooks/use-media';

import { clockOf } from './tv';

/** Today on one channel, from midnight to midnight, what is on now marked — and a way to watch it. */
export function ChannelGuideScreen({ channel, name, group }: { channel: GlobalMediaKey; name: string; group?: string }) {
  // Midnight, in the device's own time; fixed while the screen is open.
  const [midnight] = useState(() => {
    const at = new Date();
    at.setHours(0, 0, 0, 0);
    return at.getTime();
  });
  const guide = useGuide(channel.connectionId, [channel], { from: midnight, hours: 24 });
  const refresh = useRefreshMedia();
  const now = useNow();
  const programmes = [...(guide.data?.value ?? [])].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const watch = () => router.push(liveHref(channel, name, group));

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <FlatList
        data={programmes}
        keyExtractor={(programme) => programme.startsAt}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        ListHeaderComponent={
          <YStack gap="$3" pb="$4">
            <PrimaryButton size="$4" self="flex-start" icon={<Play size={18} fill="currentColor" />} onPress={watch}>
              Watch live
            </PrimaryButton>
            <SourceNotices errors={guide.data?.sourceError ? [guide.data.sourceError] : []} onRetry={() => void refresh()} />
          </YStack>
        }
        renderItem={({ item }) => {
          const airing = Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) > now;
          const over = Date.parse(item.endsAt) <= now;
          return (
            <XStack gap="$3" py="$2.5" opacity={over ? 0.5 : 1} bg={airing ? '$accent3' : undefined} rounded="$3" px="$2">
              <SizableText size="$3" color={airing ? '$accent11' : '$color10'} width={96} fontWeight={airing ? '700' : '400'}>
                {`${clockOf(item.startsAt)} – ${clockOf(item.endsAt)}`}
              </SizableText>
              <YStack flex={1} gap="$1">
                <SizableText size="$4" color="$color12" fontWeight={airing ? '700' : '500'}>
                  {item.title}
                </SizableText>
                {item.description ? (
                  <Paragraph size="$2" color="$color10" numberOfLines={2}>
                    {item.description}
                  </Paragraph>
                ) : null}
              </YStack>
            </XStack>
          );
        }}
        ListEmptyComponent={
          guide.isPending ? (
            <Spinner size="large" color="$accent9" my="$8" />
          ) : (
            <SizableText color="$color10">{guide.error ? guide.error.message : 'No guide for today.'}</SizableText>
          )
        }
      />
    </>
  );
}
