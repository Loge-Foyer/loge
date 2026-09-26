import type { ReactElement, ReactNode } from 'react';
import { ScrollView, type RefreshControlProps } from 'react-native';
import { YStack } from 'tamagui';

/**
 * A scrolling screen body. The React Native ScrollView comes first so native
 * large titles collapse and tab-bar insets apply to it. `flush` drops the side
 * padding, for rows that run to the edges.
 */
export function Screen({
  children,
  gap = '$6',
  flush = false,
  refreshControl,
}: {
  children: ReactNode;
  gap?: '$4' | '$6';
  flush?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} {...(refreshControl ? { refreshControl } : {})}>
      <YStack gap={gap} px={flush ? 0 : '$4'} pt="$4" pb="$12" width="100%" maxW={flush ? undefined : 1200} self="center">
        {children}
      </YStack>
    </ScrollView>
  );
}
