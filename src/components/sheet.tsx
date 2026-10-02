import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { H2, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';

/**
 * One inset for the title and for what scrolls under it, roomier than a
 * page's: a sheet is read close up, with nothing beside it. On a TV, where a
 * sheet takes the screen, the title-safe gutter is the larger.
 */
const INSET = Math.max(GUTTER, px(24));

/**
 * A sheet's page: its title and Done, then what scrolls under them. The
 * content starts a little below the edge it scrolls under — flush against it,
 * the first card's border and rounded corners were cut off by that edge
 * before anything had moved.
 */
export function SheetScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <YStack flex={1} bg="$background">
      <XStack px={INSET} pt="$6" pb="$4" items="center" justify="space-between">
        <H2 size="$8" color="$color12">
          {title}
        </H2>
        <Button size="$3" onPress={() => router.back()}>
          Done
        </Button>
      </XStack>
      <ScrollView contentContainerStyle={{ paddingHorizontal: INSET, paddingTop: px(12), paddingBottom: px(64), gap: px(20) }}>{children}</ScrollView>
    </YStack>
  );
}
