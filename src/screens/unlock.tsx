import type { UserId } from '@sc/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, SizableText, YStack } from 'tamagui';

import { describeOwnerVerdict } from '@/components/labels';
import { PinPad } from '@/components/pin-pad';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useServices } from '@/hooks/services-context';
import { useOwnerMethod } from '@/hooks/use-account';
import { usePinActions } from '@/hooks/use-pin';
import { useProfiles } from '@/hooks/use-profiles';
import type { OwnerVerdict } from '@/services/owner-check';
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

  // The PIN is gone: the profile opens like any profile without one.
  const reset = async () => {
    await session.select(userId);
    if (mode === 'switch') router.dismissAll();
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
      <ForgotPin userId={userId} onReset={() => void reset()} onRefused={setMessage} />
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

/**
 * "Forgot PIN?" where the owner can be asked — through the account, or with
 * Face ID or the passcode. Where they cannot, a PIN stays until it is typed.
 */
export function ForgotPin({
  userId,
  onReset,
  onRefused,
}: {
  userId: UserId;
  onReset: () => void;
  onRefused: (message: string) => void;
}) {
  const { data: method } = useOwnerMethod();
  const { forgot } = usePinActions();
  if (method === undefined) return null;
  if (method === null) {
    return (
      <SizableText size="$2" color="$color10" text="center">
        Forgot it? An account lets you reset a PIN.
      </SizableText>
    );
  }
  return (
    <Button
      chromeless
      size="$3"
      color="$accent10"
      disabled={forgot.isPending}
      onPress={() =>
        forgot.mutate(userId, {
          onSuccess: (verdict: OwnerVerdict) => {
            if (verdict === 'verified') {
              onReset();
              return;
            }
            const text = describeOwnerVerdict(verdict);
            if (text) onRefused(text);
          },
        })
      }
    >
      Forgot PIN?
    </Button>
  );
}
