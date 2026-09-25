import { ScrollView } from 'react-native';
import { Button, XStack } from 'tamagui';

export interface SourceTab {
  readonly id: string;
  readonly label: string;
}

/** One tab per source, across the top of Videos. */
export function SourceTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: readonly SourceTab[];
  selected: string;
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
            >
              {tab.label}
            </Button>
          );
        })}
      </XStack>
    </ScrollView>
  );
}
