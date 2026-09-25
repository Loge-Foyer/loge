import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Settings } from '@tamagui/lucide-icons-2/icons/Settings';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Button, SizableText, XStack, YStack } from 'tamagui';

import { ProfileButton } from './profile-button';

/** In a browser the tabs are a top navigation bar, which is also each tab's header. */
export function AppTabs() {
  return (
    <Tabs>
      <TabList asChild>
        <TopBar>
          <TabTrigger name="media" href="/media" asChild>
            <TopBarTab icon={Film}>Media</TopBarTab>
          </TabTrigger>
          <TabTrigger name="videos" href="/videos" asChild>
            <TopBarTab icon={Tv}>Videos</TopBarTab>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TopBarTab icon={Settings}>Settings</TopBarTab>
          </TabTrigger>
        </TopBar>
      </TabList>
      <TabSlot style={{ flex: 1 }} />
    </Tabs>
  );
}

function TopBar({ children }: TabListProps) {
  return (
    <YStack borderBottomWidth={1} borderColor="$borderColor" bg="$background">
      <XStack
        height={64}
        px="$4"
        gap="$2"
        items="center"
        width="100%"
        maxW={1200}
        self="center"
        role="tablist"
      >
        <SizableText size="$6" fontWeight="800" color="$color12" mr="$5" letterSpacing={-0.5}>
          Streaming <SizableText size="$6" fontWeight="800" color="$accent10">Center</SizableText>
        </SizableText>
        {children}
        <XStack flex={1} />
        <ProfileButton />
      </XStack>
    </YStack>
  );
}

type Icon = NonNullable<ComponentProps<typeof Button>['icon']>;

// Only what the trigger needs from its slot props: RN's optional props are
// typed `| undefined`, which Tamagui's exact optional props refuse wholesale.
function TopBarTab({ children, isFocused, onPress, icon }: TabTriggerSlotProps & { icon: Icon }) {
  return (
    <Button
      {...(onPress ? { onPress } : {})}
      size="$3"
      rounded="$10"
      role="tab"
      aria-selected={isFocused ?? false}
      bg={isFocused ? '$color4' : 'transparent'}
      hoverStyle={{ bg: '$color3' }}
      borderWidth={0}
      color={isFocused ? '$color12' : '$color10'}
      icon={icon}
    >
      {children}
    </Button>
  );
}
