import type { UserId } from '@sc/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, YStack } from 'tamagui';

import { PinPad } from '@/components/pin-pad';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useServices } from '@/hooks/services-context';
import { useProfiles } from '@/hooks/use-profiles';
import type { PinCheck } from '@/services/pins';

export function describeFailure(check: Exclude<PinCheck, { ok: true }>): string {
  if (check.reason === 'locked') {
    return `Too many tries. Wait ${Math.ceil(check.retryInMs / 1000)} seconds.`;
  }
  return `Wrong PIN. ${check.attemptsLeft} ${check.attemptsLeft === 1 ? 'try' : 'tries'} left.`;
}

/** Entering a PIN-protected profile: at launch, or when switching to it. */
export function UnlockScreen({ userId, mode }: { userId: UserId; mode: 'boot' | 'switch' }) {
  const { session } = useServices();
  const user = useProfiles().data?.find((profile) => profile.id === userId);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (pin: string) => {
    setBusy(true);
    const check = await session.unlock(userId, pin);
    setBusy(false);
    if (check.ok) {
      if (mode === 'switch') router.dismissAll();
      return;
    }
    setMessage(describeFailure(check));
  };

  return (
    <YStack flex={1} bg="$background" items="center" justify="center" p="$6" gap="$6">
      {user ? <ProfileAvatar user={user} size={72} /> : null}
      <PinPad
        title={user ? `Enter ${user.name}’s PIN` : 'Enter PIN'}
        {...(message ? { message, tone: 'error' as const } : {})}
        disabled={busy}
        onComplete={(pin) => void submit(pin)}
      />
      <Button
        chromeless
        color="$color10"
        onPress={() => (mode === 'switch' ? router.back() : session.chooseAnother())}
      >
        {mode === 'switch' ? 'Cancel' : 'Choose another profile'}
      </Button>
    </YStack>
  );
}
