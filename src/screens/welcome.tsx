import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { Upload } from '@tamagui/lucide-icons-2/icons/Upload';
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { Button, H1, Paragraph, SizableText, Spinner, useTheme, YStack } from 'tamagui';

import { PrimaryButton } from '@/components/primary-button';
import { TextInput } from '@/components/text-input';
import { useServices } from '@/hooks/services-context';
import { useAccount } from '@/hooks/use-account';
import { useGate } from '@/hooks/use-session';
import { ImportFlow } from '@/screens/import-flow';
import { SignInFlow } from '@/screens/sign-in-flow';

type Step = 'choose' | 'local' | 'sign-in' | 'restore' | 'arriving';

/**
 * The first launch on a device: an account kept here, with a first profile
 * named after it; or your own server's, whose profiles then arrive in "Who's
 * watching?". And an account left with no profile asks for a first one.
 */
export function WelcomeScreen() {
  const { account, session } = useServices();
  const gate = useGate();
  const [step, setStep] = useState<Step>('choose');
  const servers = account.servers();

  if (gate.kind === 'needs-first-user') return <FirstProfile />;

  switch (step) {
    case 'choose':
      return (
        <Page>
          <Heading
            title="Welcome"
            body="Your profiles, their PINs and settings, and your sources live in an account. Keep it on this device, or on your own server to share it with every device you sign in on — or bring one back from a backup."
          />
          <YStack gap="$3">
            <PrimaryButton size="$5" onPress={() => setStep('local')}>
              Create an account on this device
            </PrimaryButton>
            {servers.length > 0 ? (
              <Button size="$5" icon={<Cloud size={18} />} onPress={() => setStep('sign-in')}>
                Sign in to your server
              </Button>
            ) : null}
            <Button size="$5" icon={<Upload size={18} />} onPress={() => setStep('restore')}>
              Restore a backup
            </Button>
          </YStack>
        </Page>
      );
    case 'local':
      return <LocalAccount onBack={() => setStep('choose')} />;
    case 'sign-in':
      return (
        <Page>
          <Eyebrow />
          <SignInFlow
            start={{ kind: 'pick' }}
            onCancel={() => setStep('choose')}
            onDone={async () => {
              // The gate moves by itself — to "Who's watching?", or to a first profile; this only waits for it.
              setStep('arriving');
              await session.refresh();
            }}
          />
        </Page>
      );
    case 'restore':
      return (
        <Page>
          <Eyebrow />
          <ImportFlow
            onCancel={() => setStep('choose')}
            onDone={async () => {
              // As after a sign-in: the gate moves to "Who's watching?", and this only waits for it.
              setStep('arriving');
              await session.refresh();
            }}
          />
        </Page>
      );
    case 'arriving':
      return (
        <Page>
          <YStack items="center" gap="$4">
            <Spinner size="large" color="$accent9" />
            <Paragraph size="$5" color="$color11">
              Bringing your profiles…
            </Paragraph>
          </YStack>
        </Page>
      );
  }
}

/** An account on this device: its name, which its first profile takes too. */
function LocalAccount({ onBack }: { onBack: () => void }) {
  const { account, session } = useServices();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const userId = await account.createLocal(name);
      await session.refresh();
      await session.select(userId);
    },
  });
  return (
    <Page>
      <Heading
        title="Who is this?"
        body="Your name names the account and its first profile. Everyone can have a profile of their own later — with their own history, favourites and, if they like, a PIN."
      />
      <TextInput size="$5" value={name} onChangeText={setName} placeholder="Your name" autoFocus onSubmitEditing={() => create.mutate()} aria-label="Your name" />
      {create.error ? (
        <SizableText size="$3" color="$red10">
          {create.error.message}
        </SizableText>
      ) : null}
      <PrimaryButton size="$5" disabled={create.isPending} onPress={() => create.mutate()}>
        Continue
      </PrimaryButton>
      <Button chromeless color="$color10" self="flex-start" px={0} onPress={onBack}>
        Back
      </Button>
    </Page>
  );
}

/** An account with no profile left — or none yet on your server — names a first one. */
function FirstProfile() {
  const { profiles, session } = useServices();
  const { data: current } = useAccount();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const user = await profiles.create(name);
      await session.refresh();
      await session.select(user.id);
    },
  });

  return (
    <Page>
      <Heading
        title="Who is this?"
        body={`${current?.name ?? 'Your account'} has no profiles yet. Name the first one — every device of the account gets it.`}
      />
      <TextInput size="$5" value={name} onChangeText={setName} placeholder="Your name" autoFocus onSubmitEditing={() => create.mutate()} aria-label="Profile name" />
      {create.error ? (
        <SizableText size="$3" color="$red10">
          {create.error.message}
        </SizableText>
      ) : null}
      <PrimaryButton size="$5" disabled={create.isPending} onPress={() => create.mutate()}>
        Continue
      </PrimaryButton>
    </Page>
  );
}

/** Centred on a large screen, scrolling on a small one: a sign-in form can be taller than a phone. */
function Page({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: String(theme.background.val) }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <YStack flex={1} items="center" justify="center" p="$6">
        <YStack width="100%" maxW={420} gap="$5">
          {children}
        </YStack>
      </YStack>
    </ScrollView>
  );
}

function Eyebrow() {
  return (
    <SizableText size="$3" fontWeight="700" color="$accent10" textTransform="uppercase">
      Streaming Center
    </SizableText>
  );
}

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <YStack gap="$2">
      <Eyebrow />
      <H1 size="$10" color="$color12">
        {title}
      </H1>
      <Paragraph size="$5" color="$color11">
        {body}
      </Paragraph>
    </YStack>
  );
}
