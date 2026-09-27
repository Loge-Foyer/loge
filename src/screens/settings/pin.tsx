import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Paragraph, YStack } from 'tamagui';

import { PinPad } from '@/components/pin-pad';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { usePinActions } from '@/hooks/use-pin';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { describeFailure, ForgotPin } from '@/screens/unlock';

type Step =
  | { kind: 'menu' }
  | { kind: 'current'; then: 'change' | 'remove' }
  | { kind: 'new'; current?: string }
  | { kind: 'confirm'; current?: string; next: string };

/** The active profile's PIN: a lock against the wrong person, not a password. */
export function PinScreen() {
  const userId = useActiveUserId();
  const profile = useProfiles().data?.find((candidate) => candidate.id === userId);
  const { create, change, remove } = usePinActions();
  const [step, setStep] = useState<Step>({ kind: 'menu' });
  const [message, setMessage] = useState<{ text: string; tone: 'hint' | 'error' }>();
  // The account's password takes the pad's place while it is asked for.
  const [asking, setAsking] = useState(false);

  if (!profile) return <Screen>{null}</Screen>;

  const done = () => router.back();
  const fail = (text: string) => setMessage({ text, tone: 'error' });

  if (step.kind === 'menu') {
    return (
      <Screen>
        <Paragraph color="$color11">
          A PIN keeps {profile.name}’s profile — its history, favourites and sources — for{' '}
          {profile.name}. It is asked for whenever someone switches to it.
        </Paragraph>
        <SettingsSection>
          {profile.pinProtected ? (
            <>
              <SettingsRow title="Change PIN" onPress={() => setStep({ kind: 'current', then: 'change' })} />
              <SettingsRow
                title="Turn off PIN"
                destructive
                onPress={() => setStep({ kind: 'current', then: 'remove' })}
              />
            </>
          ) : (
            <SettingsRow title="Set a PIN" onPress={() => setStep({ kind: 'new' })} />
          )}
        </SettingsSection>
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

  switch (step.kind) {
    case 'current':
      return pad(
        'Enter the current PIN',
        (current) => {
          if (step.then === 'change') {
            setStep({ kind: 'new', current });
            return;
          }
          remove.mutate(
            { userId, current },
            { onSuccess: (check) => (check.ok ? done() : fail(describeFailure(check))) },
          );
        },
        // Cleared, the PIN is simply off: the menu then offers to set one.
        <ForgotPin
          userId={userId}
          onReset={() => {
            setAsking(false);
            setStep({ kind: 'menu' });
          }}
          onRefused={fail}
          onAsking={setAsking}
        />,
      );
    case 'new':
      return pad('Choose a new four-digit PIN', (next) =>
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
            },
          );
        }
      });
  }
}
