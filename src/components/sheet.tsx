import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { H2, XStack, YStack, useTheme } from 'tamagui';

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
 * content starts a little below the title — flush against an edge, the first
 * card's border and rounded corners were cut off before anything had moved.
 *
 * One scroll view and nothing beside it, with the title as its first, sticky
 * row. An iOS form sheet resizes the scroll view it finds to the whole sheet
 * from its top unless that scroll view is the second of exactly two children
 * (react-native-screens, `coerceChildScrollViewComponentSizeToSize`), so a
 * title row beside it was drawn under the content, Done included. Inside it,
 * there is nothing for the sheet to cover.
 */
export function SheetScreen({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: String(theme.background.val) }}
      contentContainerStyle={{ paddingBottom: px(64) }}
      contentInsetAdjustmentBehavior="never"
      stickyHeaderIndices={[0]}
    >
      <XStack bg="$background" px={INSET} pt="$6" pb="$3" items="center" justify="space-between">
        <H2 size="$8" color="$color12">
          {title}
        </H2>
        <Button size="$3" onPress={() => router.back()}>
          Done
        </Button>
      </XStack>
      <YStack px={INSET} pt={px(12)} gap={px(20)}>
        {children}
      </YStack>
    </ScrollView>
  );
}
