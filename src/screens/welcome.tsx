import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { H1, Paragraph, SizableText, YStack } from 'tamagui';

import { PrimaryButton } from '@/components/primary-button';
import { TextInput } from '@/components/text-input';
import { useServices } from '@/hooks/services-context';

/** The first launch on a device: name its first profile. */
export function WelcomeScreen() {
  const { profiles, session } = useServices();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const user = await profiles.create(name);
      await session.select(user.id);
    },
  });

  return (
    <YStack flex={1} bg="$background" items="center" justify="center" p="$6">
      <YStack width="100%" maxW={420} gap="$5">
        <YStack gap="$2">
          <SizableText size="$3" fontWeight="700" color="$accent10" textTransform="uppercase">
            Streaming Center
          </SizableText>
          <H1 size="$10" color="$color12">
            Who is this?
          </H1>
          <Paragraph size="$5" color="$color11">
            Name the first profile on this device. Everyone can have their own later — with their
            own history, favourites and, if they like, a PIN.
          </Paragraph>
        </YStack>
        <TextInput
          size="$5"
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          autoFocus
          onSubmitEditing={() => create.mutate()}
          aria-label="Profile name"
        />
        {create.error ? (
          <SizableText size="$3" color="$red10">
            {create.error.message}
          </SizableText>
        ) : null}
        <PrimaryButton size="$5" disabled={create.isPending} onPress={() => create.mutate()}>
          Continue
        </PrimaryButton>
      </YStack>
    </YStack>
  );
}
