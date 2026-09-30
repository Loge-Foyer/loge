import type { UserId } from '@sc/api';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Circle, H1, SizableText, XStack, YStack } from 'tamagui';

import { PrimaryButton } from '@/components/primary-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { TextInput } from '@/components/text-input';
import { useServices } from '@/hooks/services-context';
import { useMaxProfiles } from '@/hooks/use-account';
import { useProfileActions, useProfiles } from '@/hooks/use-profiles';
import { useGate } from '@/hooks/use-session';

/**
 * "Who's watching?" — at launch when there is no default profile, and as the
 * profile switcher while the app runs. Switching never restarts anything.
 */
export function ProfilePicker({ mode }: { mode: 'boot' | 'switch' }) {
  const { session } = useServices();
  const gate = useGate();
  const activeId = gate.kind === 'ready' ? gate.userId : undefined;
  const { data: profiles = [] } = useProfiles();
  const { create } = useProfileActions();
  const { data: maxProfiles } = useMaxProfiles();
  const full = maxProfiles !== undefined && profiles.length >= maxProfiles;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const choose = useMutation({
    mutationFn: async (userId: UserId) => {
      const outcome = await session.select(userId);
      // At launch the gate itself moves on; in-app, a PIN profile gets its unlock screen.
      if (mode === 'switch') {
        if (outcome === 'locked') router.push({ pathname: '/unlock/[userId]', params: { userId } });
        else router.dismissAll();
      }
    },
  });

  const add = () =>
    create.mutate(name, {
      onSuccess: () => {
        setName('');
        setAdding(false);
      },
    });

  return (
    <YStack flex={1} bg="$background" items="center" justify="center" p="$6" gap="$7">
      <H1 size="$9" color="$color12" text="center">
        Who’s watching?
      </H1>
      <XStack flexWrap="wrap" justify="center" gap="$5" maxW={720}>
        {profiles.map((profile) => (
          <Button
            key={profile.id}
            unstyled
            onPress={() => choose.mutate(profile.id)}
            disabled={choose.isPending}
            aria-label={profile.pinProtected ? `${profile.name}, PIN required` : profile.name}
          >
            <YStack items="center" gap="$2" width={104}>
              <YStack>
                <YStack
                  rounded={999}
                  borderWidth={3}
                  borderColor={profile.id === activeId ? '$accent9' : 'transparent'}
                  p="$1"
                >
                  <ProfileAvatar user={profile} size={84} />
                </YStack>
                {profile.pinProtected ? (
                  <Circle size={26} bg="$color3" position="absolute" b={0} r={0} borderWidth={2} borderColor="$background">
                    <Lock size={13} color="$color11" />
                  </Circle>
                ) : null}
              </YStack>
              <SizableText size="$4" color="$color12" numberOfLines={1}>
                {profile.name}
              </SizableText>
            </YStack>
          </Button>
        ))}
        {full ? null : (
          <Button unstyled onPress={() => setAdding(true)} aria-label="Add a profile">
            <YStack items="center" gap="$2" width={104}>
              <Circle size={92} borderWidth={2} borderStyle="dashed" borderColor="$color7">
                <Plus size={32} color="$color10" />
              </Circle>
              <SizableText size="$4" color="$color10">
                Add profile
              </SizableText>
            </YStack>
          </Button>
        )}
      </XStack>
      {adding && !full ? (
        <XStack gap="$2" width="100%" maxW={420}>
          <TextInput
            flex={1}
            value={name}
            onChangeText={setName}
            placeholder="Name"
            autoFocus
            onSubmitEditing={add}
            aria-label="New profile name"
          />
          <PrimaryButton onPress={add} disabled={create.isPending}>
            Add
          </PrimaryButton>
        </XStack>
      ) : null}
      {create.error ? <SizableText color="$red10">{create.error.message}</SizableText> : null}
      {mode === 'switch' ? (
        <Button chromeless onPress={() => router.back()} color="$color10">
          Cancel
        </Button>
      ) : null}
    </YStack>
  );
}
