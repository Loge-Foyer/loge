import type { ReactNode } from 'react';
import { Circle, H2, Paragraph, YStack } from 'tamagui';

/** The hero a tab shows while nothing feeds it. */
export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <YStack
      rounded="$9"
      overflow="hidden"
      borderWidth={1}
      borderColor="$accent4"
      bg="$accent2"
      p="$6"
      gap="$4"
      items="flex-start"
      $md={{ p: '$9' }}
    >
      <Circle size={56} bg="$accent4">
        {icon}
      </Circle>
      <YStack gap="$2" maxW={560}>
        <H2 size="$9" color="$color12">
          {title}
        </H2>
        <Paragraph size="$5" color="$color11">
          {body}
        </Paragraph>
      </YStack>
      {children}
    </YStack>
  );
}
