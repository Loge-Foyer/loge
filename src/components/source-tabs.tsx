import { EyeOff } from '@tamagui/lucide-icons-2/icons/EyeOff';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import type { ReactElement } from 'react';
import { ScrollView } from 'react-native';
import { Circle, XStack } from 'tamagui';

import { Button } from '@/components/button';

export interface SourceTab {
  readonly id: string;
  /** Empty for a tab that is its icon alone, which then says what it is in `name`. */
  readonly label: string;
  readonly icon?: ReactElement;
  /** What it is called aloud, for a tab with no label. */
  readonly name?: string;
  /** A small sign after the label: something to finish, a PIN to enter first, or not in use. */
  readonly marker?: 'attention' | 'locked' | 'off';
}

/** One tab per choice, as pills — across the top of Videos, and for profiles in forms. */
export function SourceTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: readonly SourceTab[];
  /** None while the choice is still being made. */
  selected?: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <XStack gap="$2" role="tablist">
        {tabs.map((tab) => {
          const active = tab.id === selected;
          return (
            <Button
              key={tab.id}
              size="$3"
              rounded="$10"
              role="tab"
              aria-selected={active}
              bg={active ? '$accentBackground' : '$color3'}
              color={active ? '$accentColor' : '$color11'}
              borderWidth={0}
              fontWeight={active ? '600' : '400'}
              onPress={() => onSelect(tab.id)}
              {...(tab.icon ? { icon: tab.icon } : {})}
              {...(tab.name ? { 'aria-label': tab.name } : {})}
              {...(tab.marker === 'locked' ? { iconAfter: <Lock size={12} />, 'aria-label': `${tab.label}, locked` } : {})}
              {...(tab.marker === 'off' ? { iconAfter: <EyeOff size={12} />, 'aria-label': `${tab.label}, not used` } : {})}
              {...(tab.marker === 'attention'
                ? { iconAfter: <Circle size={7} bg={active ? '$accentColor' : '$orange9'} aria-label="needs attention" /> }
                : {})}
            >
              {/* An icon alone has no words: an empty string is a bare text node, which Tamagui reports on the web with props LogBox cannot print, and the tab throws. */}
              {tab.label || null}
            </Button>
          );
        })}
      </XStack>
    </ScrollView>
  );
}
