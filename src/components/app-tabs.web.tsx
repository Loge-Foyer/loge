import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Settings } from '@tamagui/lucide-icons-2/icons/Settings';
import { SquarePlay } from '@tamagui/lucide-icons-2/icons/SquarePlay';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { SizableText, XStack, YStack, useMedia } from 'tamagui';

import { Button } from '@/components/button';
import { ProfileButton } from './profile-button';

/** In a browser the tabs are a top navigation bar, which is also each tab's header. */
export function AppTabs() {
  return (
    <Tabs>
      <TabList asChild>
        <TopBar>
          <TabTrigger name="media" href="/media" asChild>
            <TopBarTab icon={Film} label="Media" />
          </TabTrigger>
          <TabTrigger name="videos" href="/videos" asChild>
            <TopBarTab icon={SquarePlay} label="Videos" />
          </TabTrigger>
          <TabTrigger name="live" href="/live" asChild>
            <TopBarTab icon={Tv} label="Live" />
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TopBarTab icon={Settings} label="Settings" />
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
        <SizableText
          size="$6"
          fontWeight="800"
          color="$accent10"
          mr="$5"
          letterSpacing={-0.5}
          display="none"
          $md={{ display: 'flex' }}
        >
          Loge
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
// A narrow window gets the icons alone: four labels, the name and the profile
// do not fit beside each other on a phone's browser.
function TopBarTab({ isFocused, onPress, icon, label }: TabTriggerSlotProps & { icon: Icon; label: string }) {
  const media = useMedia();
  return (
    <Button
      {...(onPress ? { onPress } : {})}
      size="$3"
      rounded="$10"
      role="tab"
      aria-label={label}
      aria-selected={isFocused ?? false}
      bg={isFocused ? '$color4' : 'transparent'}
      hoverStyle={{ bg: '$color3' }}
      borderWidth={0}
      color={isFocused ? '$color12' : '$color10'}
      icon={icon}
    >
      {media.sm ? label : null}
    </Button>
  );
}
