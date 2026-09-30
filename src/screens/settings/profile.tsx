import type { UserId } from '@sc/api';
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { SizableText, XStack, YStack } from 'tamagui';

import { ConfirmButton } from '@/components/confirm-button';
import { PinPad } from '@/components/pin-pad';
import { PrimaryButton } from '@/components/primary-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { TextInput } from '@/components/text-input';
import { useServices } from '@/hooks/services-context';
import { useDefaultUserId, useProfileActions, useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { describeFailure } from '@/screens/unlock';

/**
 * Rename, default, delete. Another profile's PIN is asked for first, so a child
 * cannot rename or delete a parent's profile from their own.
 */
export function ProfileScreen({ userId }: { userId: UserId }) {
  const activeId = useActiveUserId();
  const { pins } = useServices();
  const { data: profiles } = useProfiles();
  const { data: defaultUserId } = useDefaultUserId();
  const { rename, remove, setDefault } = useProfileActions();
  const profile = profiles?.find((candidate) => candidate.id === userId);
  const [unlocked, setUnlocked] = useState(false);
  const [pinMessage, setPinMessage] = useState<string>();
  const [name, setName] = useState<string>();

  if (!profiles) return <Screen>{null}</Screen>;
  if (!profile) {
    return (
      <Screen>
        <SizableText color="$color10">This profile no longer exists.</SizableText>
      </Screen>
    );
  }

  const title = <Stack.Screen options={{ title: profile.name }} />;

  if (profile.pinProtected && profile.id !== activeId && !unlocked) {
    return (
      <Screen>
        {title}
        <YStack py="$6">
          <PinPad
            title={`Enter ${profile.name}’s PIN to manage this profile`}
            {...(pinMessage ? { message: pinMessage, tone: 'error' as const } : {})}
            onComplete={async (pin) => {
              const check = await pins.verify(profile.id, pin);
              if (check.ok) setUnlocked(true);
              else setPinMessage(describeFailure(check));
            }}
          />
        </YStack>
      </Screen>
    );
  }

  const draftName = name ?? profile.name;
  const isDefault = profile.id === defaultUserId;

  return (
    <Screen>
      {title}
      <XStack items="center" gap="$4">
        <ProfileAvatar user={profile} size={64} />
        <YStack flex={1} gap="$2">
          <TextInput value={draftName} onChangeText={setName} aria-label="Profile name" />
          {rename.error ? <SizableText color="$red10">{rename.error.message}</SizableText> : null}
        </YStack>
        <PrimaryButton
          disabled={draftName.trim() === profile.name || rename.isPending}
          onPress={() => rename.mutate({ id: profile.id, name: draftName }, { onSuccess: () => setName(undefined) })}
        >
          Save
        </PrimaryButton>
      </XStack>

      <SettingsSection footer="The default profile opens when the app starts on this device.">
        <SettingsRow
          title={isDefault ? 'Opens at launch' : 'Open this profile at launch'}
          subtitle={isDefault ? 'This is the default profile on this device' : 'Make it the default on this device'}
          disabled={isDefault}
          onPress={() => setDefault.mutate(profile.id)}
        />
      </SettingsSection>

      <YStack gap="$2" items="flex-start">
        <ConfirmButton
          label="Delete profile"
          icon={<Trash2 size={16} />}
          title={`Delete ${profile.name}?`}
          description="It goes from your account, on every device, with its history, favourites and its own sign-ins. Connections stay for the other profiles."
          confirmLabel="Delete"
          disabled={profiles.length === 1 || remove.isPending}
          onConfirm={() => remove.mutate(profile.id, { onSuccess: () => router.back() })}
        />
        {profiles.length === 1 ? (
          <SizableText size="$2" color="$color10">
            The only profile on a device cannot be deleted.
          </SizableText>
        ) : null}
        {remove.error ? <SizableText color="$red10">{remove.error.message}</SizableText> : null}
      </YStack>
    </Screen>
  );
}
