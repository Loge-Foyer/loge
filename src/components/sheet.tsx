import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { H2, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';

/**
 * A sheet's page: its title and Done, then what scrolls under them. The
 * content starts a little below the edge it scrolls under — flush against it,
 * the first card's border and rounded corners were cut off by that edge
 * before anything had moved.
 */
export function SheetScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <YStack flex={1} bg="$background">
      <XStack px="$4" pt="$5" pb="$3" items="center" justify="space-between">
        <H2 size="$8" color="$color12">
          {title}
        </H2>
        <Button size="$3" onPress={() => router.back()}>
          Done
        </Button>
      </XStack>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48, gap: 16 }}>{children}</ScrollView>
    </YStack>
  );
}
