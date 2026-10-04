import type { AppUser } from '@loge/api';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, H1, SizableText, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';
import { PrimaryButton } from '@/components/primary-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { CARD_RING } from '@/components/remote';
import { TextInput } from '@/components/text-input';

import { useProfilePicker, type PickerMode } from './use-profile-picker';

const TILE = px(112);
const COLUMN_GAP = px(24);
// Two tiles to a row on a phone and up to five from a tablet's width; the
// slack is less than a tile, so it never lets in one more.
const PHONE_ROW = 2 * TILE + COLUMN_GAP + px(40);
const WIDE_ROW = 5 * TILE + 4 * COLUMN_GAP + px(40);

/**
 * Who's watching on a phone, a tablet or in a browser: the question at the
 * top and the profiles beneath it as square tiles, two to a row on a phone.
 * While the app runs, Cancel and Edit sit either side of the question.
 */
export function MobileProfilePicker({ mode }: { mode: PickerMode }) {
  return (
    // Its own safe area: as a sheet on an iPhone it starts below the status
    // bar, which the app's insets would leave room for a second time.
    <SafeAreaProvider>
      <Picker mode={mode} />
    </SafeAreaProvider>
  );
}

function Picker({ mode }: { mode: PickerMode }) {
  const picker = useProfilePicker(mode);
  const insets = useSafeAreaInsets();
  const switching = mode === 'switch';
  return (
    <YStack flex={1} bg="$background" pt={insets.top} pb={insets.bottom} pl={insets.left} pr={insets.right}>
      <XStack items="center" px={GUTTER} minH={px(56)}>
        <XStack flex={1}>
          {switching ? (
            <Button chromeless px="$2" onPress={picker.cancel}>
              Cancel
            </Button>
          ) : null}
        </XStack>
        <H1 size="$6" fontWeight="700" color="$color12" numberOfLines={1}>
          Who’s watching?
        </H1>
        <XStack flex={1} justify="flex-end">
          {switching ? (
            <Button chromeless px="$2" fontWeight="700" onPress={() => picker.edit()} aria-label="Edit profiles">
              Edit
            </Button>
          ) : null}
        </XStack>
      </XStack>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        // The name field sits under every tile; on an iPhone the keyboard would cover it.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          gap: px(28),
          paddingHorizontal: GUTTER,
          paddingVertical: px(24),
        }}
      >
        <XStack flexWrap="wrap" justify="center" columnGap={COLUMN_GAP} rowGap="$7" maxW={PHONE_ROW} $md={{ maxW: WIDE_ROW }}>
          {picker.profiles.map((profile) => (
            <ProfileTile
              key={profile.id}
              profile={profile}
              inUse={profile.id === picker.activeId}
              disabled={picker.choosing}
              onPress={() => picker.choose(profile.id)}
            />
          ))}
          {picker.full ? null : (
            <Button unstyled onPress={picker.openAdding} pressStyle={{ opacity: 0.7 }} aria-label="Add a profile">
              <Tile label="Add profile">
                <YStack width={TILE} height={TILE} rounded="$4" borderWidth={2} borderColor="$color7" items="center" justify="center">
                  <Plus size={px(40)} color="$color12" />
                </YStack>
              </Tile>
            </Button>
          )}
        </XStack>
        {picker.adding ? (
          <XStack gap="$2" width="100%" maxW={px(420)}>
            <TextInput
              flex={1}
              value={picker.name}
              onChangeText={picker.setName}
              placeholder="Name"
              // autoFocus is a browser's; on a phone Tamagui's input reads only autoFocusNative.
              autoFocus
              autoFocusNative
              returnKeyType="done"
              onSubmitEditing={() => picker.add()}
              aria-label="New profile name"
            />
            <PrimaryButton onPress={() => picker.add()} disabled={picker.addPending}>
              Add
            </PrimaryButton>
          </XStack>
        ) : null}
        {picker.addError ? <SizableText color="$red11">{picker.addError}</SizableText> : null}
      </ScrollView>
    </YStack>
  );
}

function ProfileTile({ profile, inUse, disabled, onPress }: { profile: AppUser; inUse: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Button
      unstyled
      onPress={onPress}
      disabled={disabled}
      pressStyle={{ opacity: 0.7 }}
      aria-label={profile.pinProtected ? `${profile.name}, PIN required` : profile.name}
    >
      <Tile label={profile.name}>
        {/* The profile in use, while the app runs, wears a remote's ring. */}
        <YStack position="relative" {...(inUse ? CARD_RING : {})} rounded="$4">
          <ProfileAvatar user={profile} size={TILE} shape="square" />
          {profile.pinProtected ? (
            <Circle size={px(26)} bg="$color3" position="absolute" b={px(6)} r={px(6)} borderWidth={2} borderColor="$background">
              <Lock size={px(13)} color="$color11" />
            </Circle>
          ) : null}
        </YStack>
      </Tile>
    </Button>
  );
}

/** A tile with its name beneath it. */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <YStack items="center" gap="$2" width={TILE}>
      {children}
      <SizableText size="$5" color="$color12" numberOfLines={1}>
        {label}
      </SizableText>
    </YStack>
  );
}
