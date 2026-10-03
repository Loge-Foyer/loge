import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Paragraph, SizableText, YStack } from 'tamagui';

import { PIN_SCOPE_LABELS } from '@/components/labels';
import { PinPad } from '@/components/pin-pad';
import { Screen } from '@/components/screen';
import { ChoiceRow, SettingsRow, SettingsSection } from '@/components/settings-list';
import { usePinActions, usePinStatus } from '@/hooks/use-pin';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { describeFailure, ForgotPin } from '@/screens/unlock';
import { PIN_SCOPES, type PinScope, type PinStatus } from '@/services/pins';

type Step =
  | { kind: 'menu' }
  | { kind: 'current'; then: 'change' | 'remove' }
  | { kind: 'current'; then: 'scope'; scope: PinScope }
  | { kind: 'new'; current?: string }
  | { kind: 'confirm'; current?: string; next: string };

/** What happens once the PIN asked for now has been given, said before it is asked for. */
function afterSwitching(scope: PinScope, status: PinStatus, name: string): string {
  if (scope === 'device') return 'This device then asks for no PIN until you set one for it.';
  return status.accountPin ? 'This device then asks for your account’s PIN.' : `Your account has no PIN for ${name}, so this device then asks for none.`;
}

/**
 * The active profile's PIN: a lock against the wrong person, not a password.
 * Kept with the account and asked for on every device that follows it, or
 * this device's own — a personal phone without one, the family's TV with one.
 */
export function PinScreen() {
  const userId = useActiveUserId();
  const profile = useProfiles().data?.find((candidate) => candidate.id === userId);
  const { data: status } = usePinStatus(userId);
  const { create, change, remove, setScope } = usePinActions();
  const [step, setStep] = useState<Step>({ kind: 'menu' });
  const [message, setMessage] = useState<{ text: string; tone: 'hint' | 'error' }>();
  // The account's password takes the pad's place while it is asked for.
  const [asking, setAsking] = useState(false);

  if (!profile || !status) return <Screen>{null}</Screen>;

  const done = () => router.back();
  const fail = (text: string) => setMessage({ text, tone: 'error' });
  const here = status.scope === 'device';

  const choose = (scope: PinScope) => {
    if (scope === status.scope) return;
    // The PIN asked for now is asked for first, so nobody takes a profile out of it on a device they merely picked up.
    if (status.asks) {
      setMessage({ text: afterSwitching(scope, status, profile.name), tone: 'hint' });
      setStep({ kind: 'current', then: 'scope', scope });
      return;
    }
    setMessage(undefined);
    setScope.mutate({ userId, scope }, { onError: (error) => fail(error.message) });
  };

  if (step.kind === 'menu') {
    return (
      <Screen>
        <Paragraph color="$color11">
          A PIN keeps {profile.name}’s profile — its history, favourites and sources — for{' '}
          {profile.name}. It is asked for whenever someone switches to it.
        </Paragraph>
        <SettingsSection footer="All devices: one PIN, kept with your account. This device: its own PIN, or none — whatever your account says.">
          <ChoiceRow
            title="Asked on"
            options={PIN_SCOPES}
            label={(scope) => PIN_SCOPE_LABELS[scope]}
            value={status.scope}
            disabled={setScope.isPending}
            onChoose={choose}
          />
        </SettingsSection>
        <SettingsSection
          footer={
            here
              ? status.accountPin
                ? `Only this device. Your account keeps a PIN for ${profile.name}, which this device does not ask for.`
                : 'Only this device. Your other devices keep their own setting.'
              : 'It changes on every device that follows your account.'
          }
        >
          {status.asks ? (
            <>
              <SettingsRow title={here ? 'Change this device’s PIN' : 'Change PIN'} onPress={() => setStep({ kind: 'current', then: 'change' })} />
              <SettingsRow
                title={here ? 'Turn off PIN on this device' : 'Turn off PIN'}
                destructive
                onPress={() => setStep({ kind: 'current', then: 'remove' })}
              />
            </>
          ) : (
            <SettingsRow title={here ? 'Set a PIN for this device' : 'Set a PIN'} onPress={() => setStep({ kind: 'new' })} />
          )}
        </SettingsSection>
        {message?.tone === 'error' ? <SizableText color="$red11">{message.text}</SizableText> : null}
      </Screen>
    );
  }

  const pad = (title: string, onComplete: (pin: string) => void, footer?: ReactNode) => (
    <Screen>
      <YStack py="$6" gap="$4" items="center">
        {asking ? null : (
          <PinPad
            title={title}
            {...(message ? { message: message.text, tone: message.tone } : {})}
            onComplete={(pin) => {
              setMessage(undefined);
              onComplete(pin);
            }}
          />
        )}
        {footer}
      </YStack>
    </Screen>
  );

  // Cleared, the PIN is simply off: the menu then offers to set one.
  const forgotten = (
    <ForgotPin
      userId={userId}
      onReset={() => {
        setAsking(false);
        setMessage(undefined);
        setStep({ kind: 'menu' });
      }}
      onRefused={fail}
      onAsking={setAsking}
    />
  );

  switch (step.kind) {
    case 'current':
      return pad(
        'Enter the current PIN',
        (current) => {
          if (step.then === 'scope') {
            setScope.mutate(
              { userId, scope: step.scope, current },
              {
                // Back to the menu, where setting this device's own PIN is one press away.
                onSuccess: (check) => (check.ok ? setStep({ kind: 'menu' }) : fail(describeFailure(check))),
                onError: (error) => fail(error.message),
              },
            );
            return;
          }
          if (step.then === 'change') {
            setStep({ kind: 'new', current });
            return;
          }
          remove.mutate({ userId, current }, { onSuccess: (check) => (check.ok ? done() : fail(describeFailure(check))) });
        },
        forgotten,
      );
    case 'new':
      return pad(here ? 'Choose a four-digit PIN for this device' : 'Choose a new four-digit PIN', (next) =>
        setStep({ kind: 'confirm', next, ...(step.current ? { current: step.current } : {}) }),
      );
    case 'confirm':
      return pad('Enter it again', (again) => {
        if (again !== step.next) {
          setStep({ kind: 'new', ...(step.current ? { current: step.current } : {}) });
          fail('Those did not match. Choose a PIN again.');
          return;
        }
        if (step.current === undefined) {
          create.mutate({ userId, pin: step.next }, { onSuccess: done, onError: (error) => fail(error.message) });
        } else {
          change.mutate(
            { userId, current: step.current, next: step.next },
            {
              onSuccess: (check) => {
                if (check.ok) done();
                else {
                  setStep({ kind: 'current', then: 'change' });
                  fail(describeFailure(check));
                }
              },
              onError: (error) => fail(error.message),
            },
          );
        }
      });
  }
}
