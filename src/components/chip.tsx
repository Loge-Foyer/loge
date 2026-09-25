import { SizableText, XStack } from 'tamagui';

/** A small label: what a source brings, which roles are on. */
export function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'muted' }) {
  return (
    <XStack
      px="$2.5"
      py="$1"
      rounded="$10"
      bg={tone === 'accent' ? '$accent4' : '$color3'}
      borderWidth={1}
      borderColor={tone === 'accent' ? '$accent6' : '$borderColor'}
      opacity={tone === 'muted' ? 0.6 : 1}
    >
      <SizableText size="$1" fontWeight="600" color={tone === 'accent' ? '$accent11' : '$color11'}>
        {label}
      </SizableText>
    </XStack>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <XStack gap="$1.5" flexWrap="wrap">
      {children}
    </XStack>
  );
}
