import type { ReactElement, ReactNode } from 'react';
import { ScrollView, type RefreshControlProps } from 'react-native';
import { YStack } from 'tamagui';

import { COLUMN, GUTTER } from './density';

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
    // Taps on a button go through while a field has focus: otherwise the first one after typing only puts the keyboard away.
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }}
      {...(refreshControl ? { refreshControl } : {})}
    >
      <YStack gap={gap} px={flush ? 0 : GUTTER} pt="$4" pb="$12" width="100%" maxW={flush ? undefined : COLUMN} self="center">
        {children}
      </YStack>
    </ScrollView>
  );
}
