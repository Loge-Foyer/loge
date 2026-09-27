import type { Credentials, UserId } from '@sc/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, SizableText, YStack } from 'tamagui';

import { describeOwnerVerdict, describeProofVerdict } from '@/components/labels';
import { OwnerProofForm } from '@/components/owner-proof-form';
import { PinPad } from '@/components/pin-pad';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useServices } from '@/hooks/services-context';
import { useAccount, useOwnerMethod } from '@/hooks/use-account';
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
  // The account's password takes the pad's place while it is asked for.
  const [asking, setAsking] = useState(false);

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
      {asking ? null : (
        <PinPad
          title={user ? `Enter ${user.name}’s PIN` : 'Enter PIN'}
          {...(message ? { message, tone: 'error' as const } : {})}
          disabled={busy}
          onComplete={(pin) => void submit(pin)}
        />
      )}
      <ForgotPin userId={userId} onReset={() => void reset()} onRefused={setMessage} onAsking={setAsking} />
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
 * Face ID or the passcode. An account that asks for its password gets it in a
 * form right here. Where no owner can be asked, a PIN stays until it is typed.
 */
export function ForgotPin({
  userId,
  onReset,
  onRefused,
  onAsking,
}: {
  userId: UserId;
  onReset: () => void;
  onRefused: (message: string) => void;
  /** The password form opened or closed: the host makes room for it, putting its PIN pad away. */
  onAsking?: (asking: boolean) => void;
}) {
  const { data: method } = useOwnerMethod();
  const { data: account } = useAccount();
  const { forgot } = usePinActions();
  const [asking, setAskingHere] = useState(false);
  const [error, setError] = useState<string>();
  const setAsking = (next: boolean) => {
    setAskingHere(next);
    onAsking?.(next);
  };
  if (method === undefined) return null;
  if (method === null) {
    // An account that no longer lets this device in cannot vouch for anyone, and this device cannot ask either.
    return (
      <SizableText size="$2" color="$color10" text="center">
        {account ? 'Forgot it? Sign in to your account again, then reset it here.' : 'Forgot it? An account lets you reset a PIN.'}
      </SizableText>
    );
  }
  const asks = method.via === 'account' ? method.asks : [];

  const reset = (proof?: Credentials) =>
    forgot.mutate(
      { userId, ...(proof ? { proof } : {}) },
      {
        onSuccess: (verdict: OwnerVerdict) => {
          if (verdict === 'verified') {
            setAsking(false);
            onReset();
            return;
          }
          if (proof) {
            setError(describeProofVerdict(verdict));
            return;
          }
          const text = describeOwnerVerdict(verdict);
          if (text) onRefused(text);
        },
      },
    );

  if (asking) {
    return (
      <OwnerProofForm
        asks={asks}
        prompt="Enter your account’s password to reset this PIN."
        busy={forgot.isPending}
        error={error}
        onSubmit={(proof) => {
          setError(undefined);
          reset(proof);
        }}
        onCancel={() => {
          setAsking(false);
          setError(undefined);
        }}
      />
    );
  }
  return (
    <Button chromeless size="$3" color="$accent10" disabled={forgot.isPending} onPress={() => (asks.length > 0 ? setAsking(true) : reset())}>
      Forgot PIN?
    </Button>
  );
}
