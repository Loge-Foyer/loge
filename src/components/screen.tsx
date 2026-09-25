import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { YStack } from 'tamagui';

/**
 * A scrolling screen body. The React Native ScrollView comes first so native
 * large titles collapse and tab-bar insets apply to it.
 */
export function Screen({ children, gap = '$6' }: { children: ReactNode; gap?: '$4' | '$6' }) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }}>
      <YStack gap={gap} px="$4" pt="$4" pb="$12" width="100%" maxW={1200} self="center">
        {children}
      </YStack>
    </ScrollView>
  );
}
