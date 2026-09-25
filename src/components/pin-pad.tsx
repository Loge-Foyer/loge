import { Delete } from '@tamagui/lucide-icons-2/icons/Delete';
import { useEffect, useState } from 'react';
import { Button, Circle, H3, SizableText, XStack, YStack } from 'tamagui';

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

interface PinPadProps {
  title: string;
  message?: string;
  tone?: 'hint' | 'error';
  disabled?: boolean;
  /** Called with the fourth digit; the pad clears itself for the next attempt. */
  onComplete: (pin: string) => void;
}

/**
 * Four dots and a keypad. Drawn rather than a system keyboard, so it behaves
 * the same on every platform and never offers to autofill a PIN.
 */
export function PinPad({ title, message, tone = 'hint', disabled = false, onComplete }: PinPadProps) {
  const [digits, setDigits] = useState('');

  const press = (key: (typeof KEYS)[number]) => {
    if (disabled || key === '') return;
    if (key === 'back') {
      setDigits((current) => current.slice(0, -1));
      return;
    }
    const next = (digits + key).slice(0, PIN_LENGTH);
    if (next.length === PIN_LENGTH) {
      setDigits('');
      onComplete(next);
    } else {
      setDigits(next);
    }
  };

  // A physical keyboard should work too, wherever there is one.
  useEffect(() => {
    if (process.env.EXPO_OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key as (typeof KEYS)[number]);
      else if (event.key === 'Backspace') press('back');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <YStack items="center" gap="$5" width="100%" maxW={320} self="center">
      <H3 size="$7" color="$color12" text="center">
        {title}
      </H3>
      <XStack gap="$4" aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <Circle
            key={index}
            size={16}
            borderWidth={2}
            borderColor={tone === 'error' ? '$red9' : '$accent9'}
            bg={index < digits.length ? '$accent9' : 'transparent'}
          />
        ))}
      </XStack>
      <SizableText size="$3" color={tone === 'error' ? '$red10' : '$color10'} minH="$2" text="center">
        {message ?? ' '}
      </SizableText>
      <XStack flexWrap="wrap" width={264} gap="$3" justify="center">
        {KEYS.map((key, index) =>
          key === '' ? (
            <YStack key={index} width={76} height={76} />
          ) : (
            <Button
              key={index}
              width={76}
              height={76}
              p={0}
              rounded={38}
              bg="$color3"
              borderWidth={0}
              pressStyle={{ bg: '$color5' }}
              disabled={disabled}
              onPress={() => press(key)}
              aria-label={key === 'back' ? 'Delete digit' : key}
              {...(key === 'back' ? { icon: <Delete size={24} color="$color11" /> } : {})}
            >
              {key === 'back' ? null : (
                <SizableText size="$8" color="$color12">
                  {key}
                </SizableText>
              )}
            </Button>
          ),
        )}
      </XStack>
    </YStack>
  );
}
