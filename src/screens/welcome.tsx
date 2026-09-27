import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { Button, H1, Paragraph, SizableText, Spinner, useTheme, YStack } from 'tamagui';

import { PrimaryButton } from '@/components/primary-button';
import { TextInput } from '@/components/text-input';
import { useServices } from '@/hooks/services-context';
import { useAccount, useAccountProviders } from '@/hooks/use-account';
import { SignInFlow } from '@/screens/sign-in-flow';

type Step = 'choose' | 'sign-in' | 'arriving' | 'name';

/**
 * The first launch on a device: sign in to an account, whose profiles then
 * arrive in "Who's watching?", or keep everything on this device and name
 * its first profile.
 */
export function WelcomeScreen() {
  const { session } = useServices();
  const { data: providers } = useAccountProviders();
  const { data: current } = useAccount();
  const [step, setStep] = useState<Step>();

  if (providers === undefined || current === undefined) return <Page>{null}</Page>;
  // Nothing to sign in to in this build — or signed in already — leaves naming the first profile.
  const choice = providers.length > 0 && current === null;
  const shown = step ?? (choice ? 'choose' : 'name');

  switch (shown) {
    case 'choose':
      return (
        <Page>
          <Heading
            title="Welcome"
            body="Sign in to an account to bring your household’s profiles, and keep them in step on every device. Or keep everything on this one."
          />
          <YStack gap="$3">
            <PrimaryButton size="$5" icon={<Cloud size={18} />} onPress={() => setStep('sign-in')}>
              Sign in to sync your profiles
            </PrimaryButton>
            <Button size="$5" onPress={() => setStep('name')}>
              Use on this device only
            </Button>
          </YStack>
        </Page>
      );
    case 'sign-in':
      return (
        <Page>
          <Eyebrow />
          <SignInFlow
            start={{ kind: 'pick' }}
            onCancel={() => setStep('choose')}
            onDone={async ({ profilesArrived }) => {
              if (profilesArrived === 0) {
                setStep('name');
                return;
              }
              // The gate moves to "Who's watching?" by itself; this only waits for it.
              setStep('arriving');
              await session.refresh();
              if (session.getSnapshot().kind === 'needs-first-user') setStep('name');
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
    case 'name':
      return (
        <FirstProfile
          {...(current ? { accountLabel: current.connection.label } : {})}
          {...(choice ? { onBack: () => setStep('choose') } : {})}
        />
      );
  }
}

function FirstProfile({ accountLabel, onBack }: { accountLabel?: string; onBack?: () => void }) {
  const { profiles, session } = useServices();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const user = await profiles.create(name);
      await session.select(user.id);
    },
  });

  return (
    <Page>
      <Heading
        title="Who is this?"
        body={
          accountLabel
            ? `Signed in to ${accountLabel}, which has no profiles yet. Name the first one — it joins the account, and so does everyone added later.`
            : 'Name the first profile on this device. Everyone can have their own later — with their own history, favourites and, if they like, a PIN.'
        }
      />
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
      {onBack ? (
        <Button chromeless color="$color10" self="flex-start" px={0} onPress={onBack}>
          Back
        </Button>
      ) : null}
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
