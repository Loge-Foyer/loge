import { H3, Paragraph, Spinner, YStack } from 'tamagui';

import { px } from '@/components/density';
import { PrimaryButton } from '@/components/primary-button';
import { useServices } from '@/hooks/services-context';
import { useGate } from '@/hooks/use-session';

/** Behind the splash on native; visible in a browser, or when boot fails. */
export function BootScreen() {
  const gate = useGate();
  const { session } = useServices();
  return (
    <YStack flex={1} items="center" justify="center" gap="$4" p="$6" bg="$background">
      {gate.kind === 'failed' ? (
        <>
          <H3 color="$color12">Streaming Center could not start</H3>
          <Paragraph color="$color10" text="center" maxW={px(420)}>
            {gate.message}
          </Paragraph>
          <PrimaryButton onPress={() => void session.start()}>Try again</PrimaryButton>
        </>
      ) : (
        <Spinner size="large" color="$accent9" />
      )}
    </YStack>
  );
}
