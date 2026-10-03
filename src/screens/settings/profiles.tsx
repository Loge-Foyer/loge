import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { useState } from 'react';
import { SizableText, XStack } from 'tamagui';

import { PrimaryButton } from '@/components/primary-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { TextInput } from '@/components/text-input';
import { useHeldBackProfiles, useMaxProfiles } from '@/hooks/use-account';
import { useAppSettings } from '@/hooks/use-app-settings';
import { useDefaultUserId, useProfileActions, useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';

function subtitleOf(parts: readonly (string | null)[]) {
  const subtitle = parts.filter(Boolean).join(' · ');
  return subtitle ? { subtitle } : {};
}

export function ProfilesScreen() {
  const userId = useActiveUserId();
  const { data: profiles = [] } = useProfiles();
  const { data: defaultUserId } = useDefaultUserId();
  // With the selector always shown, the default opens nothing by itself.
  const asks = useAppSettings().data?.alwaysChooseProfile ?? false;
  const { data: maxProfiles } = useMaxProfiles();
  const { data: heldBack } = useHeldBackProfiles();
  const { create } = useProfileActions();
  const [name, setName] = useState('');
  const full = maxProfiles !== undefined && profiles.length >= maxProfiles;

  const add = () => create.mutate(name, { onSuccess: () => setName('') });

  return (
    <Screen>
      <SettingsSection
        title="In your account"
        footer={`${asks ? 'Every launch asks who’s watching; the default is the profile that opens once that is off.' : 'The default profile opens at launch.'} Each profile has its own history and favourites; a PIN keeps it for its owner.${full ? ` Your account holds up to ${maxProfiles} profiles, and has no room for another.` : ''}`}
      >
        {profiles.map((profile) => (
          <SettingsRow
            key={profile.id}
            title={profile.name}
            {...subtitleOf([
              profile.id === userId ? 'You' : null,
              profile.id === defaultUserId ? (asks ? 'Default' : 'Opens at launch') : null,
              heldBack?.has(profile.id) ? 'Only on this device: your server is full' : null,
            ])}
            icon={<ProfileAvatar user={profile} size={36} />}
            trailing={profile.pinProtected ? <Lock size={16} color="$color10" /> : null}
            href={{ pathname: '/settings/profiles/[userId]', params: { userId: profile.id } }}
          />
        ))}
      </SettingsSection>

      {full ? null : (
        <SettingsSection title="Add a profile">
          <XStack gap="$2" p="$3" bg="$color2">
            <TextInput
              flex={1}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              onSubmitEditing={add}
              aria-label="New profile name"
            />
            <PrimaryButton onPress={add} disabled={create.isPending}>
              Add
            </PrimaryButton>
          </XStack>
        </SettingsSection>
      )}
      {create.error ? <SizableText color="$red11">{create.error.message}</SizableText> : null}
    </Screen>
  );
}
