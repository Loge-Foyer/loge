import type { MediaItem, Show } from '@loge/api';
import { Info } from '@tamagui/lucide-icons-2/icons/Info';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { H1, SizableText, Theme, XStack, YStack, useMedia } from 'tamagui';

import { Artwork, ArtworkLogo } from '@/components/artwork';
import { Button } from '@/components/button';
import { px } from '@/components/density';
import { titleHref } from '@/components/media/item-link';
import { PrimaryButton } from '@/components/primary-button';
import { Scrim } from '@/components/scrim';

import { resumeAtOf, useTitleActions } from '../shared/title-actions';
import { useUpNext } from '../shared/up-next';

/**
 * What the home leads with: one title, large — its poster on a phone, a wide
 * picture from a tablet up — with its logo, its genres, and two buttons: Play
 * (Resume where it stopped; a series plays its next episode) and Details,
 * which opens its sheet. The picture opens it too.
 */
export function HeroCard({ item, width, canPlay }: { item: MediaItem; width: number; canPlay: boolean }) {
  const wide = useMedia().md;
  const aspect = wide ? 16 / 9 : 2 / 3;
  const image = wide ? (item.images.backdrop ?? item.images.poster) : (item.images.poster ?? item.images.backdrop);
  const upNext = useUpNext(item.type === 'show' ? (item as Show) : undefined);
  const { play } = useTitleActions(item);
  const playing = item.type === 'show' ? upNext : item.type === 'movie' ? item : undefined;
  const resumes = resumeAtOf(playing) !== undefined;
  const open = () => router.push(titleHref(item));
  return (
    <YStack position="relative" width={width} rounded="$8" overflow="hidden" borderWidth={1} borderColor="$color5" self="center">
      <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={item.title}>
        <Artwork connectionId={item.key.connectionId} image={image} width={width} aspect={aspect} label={item.title} rounded="$0" />
      </Pressable>
      <Theme name="dark">
        <Scrim from="bottom" strength={wide ? 1 : 0.9} />
        <YStack position="absolute" l={0} r={0} b={0} p="$4" gap="$3" items="center" pointerEvents="box-none">
          {wide || !item.images.poster ? (
            // A poster carries its own title; a wide picture is given its logo.
            <ArtworkLogo
              connectionId={item.key.connectionId}
              image={item.images.logo}
              width={Math.min(px(320), width * 0.7)}
              height={Math.min(px(110), width * 0.22)}
              label={item.title}
              position="center"
              fallback={
                <H1 size="$9" color="$color12" text="center" numberOfLines={2}>
                  {item.title}
                </H1>
              }
            />
          ) : null}
          {item.genres.length > 0 ? (
            <SizableText size="$4" color="$color12" text="center" numberOfLines={1}>
              {item.genres.slice(0, 3).join('  •  ')}
            </SizableText>
          ) : null}
          <XStack gap="$3" width="100%" maxW={px(420)}>
            {canPlay && playing ? (
              <PrimaryButton flex={1} size="$4" icon={<Play size={px(18)} fill="currentColor" />} onPress={() => play(playing)}>
                {resumes ? 'Resume' : 'Play'}
              </PrimaryButton>
            ) : null}
            <Button
              flex={1}
              size="$4"
              bg="rgba(40, 40, 40, 0.85)"
              borderWidth={0}
              color="$color12"
              pressStyle={{ bg: 'rgba(60, 60, 60, 0.9)' }}
              icon={<Info size={px(18)} color="$color12" />}
              onPress={open}
            >
              Details
            </Button>
          </XStack>
        </YStack>
      </Theme>
    </YStack>
  );
}
