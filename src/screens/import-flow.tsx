import type { Credentials } from '@sc/api';
import { useState } from 'react';
import { H2, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { describeBackupProblem, describeOwnerVerdict, describeProofVerdict, listAll } from '@/components/labels';
import { OwnerProofForm } from '@/components/owner-proof-form';
import { PrimaryButton } from '@/components/primary-button';
import { TextInput } from '@/components/text-input';
import { useServices } from '@/hooks/services-context';
import { useAccount, useOwnerMethod } from '@/hooks/use-account';
import { useRefreshLocalState } from '@/hooks/use-local-state';
import { OwnerNotVerifiedError } from '@/services/account';
import { BackupError, type PreparedImport } from '@/services/backup';
import type { PickedFile } from '@/services/ports';

type Step =
  | { readonly kind: 'pick'; readonly error?: string }
  | { readonly kind: 'key'; readonly file: PickedFile; readonly error?: string }
  | { readonly kind: 'confirm'; readonly prepared: PreparedImport; readonly error?: string }
  | { readonly kind: 'completing' };

/**
 * Importing a backup, shared by Welcome and Settings — so it uses no
 * profile's hooks: at first launch there is no profile. The file is picked,
 * its key typed, everything in it checked, and only then does it say what it
 * replaces and ask the owner. The result is always an account on this device.
 * The host decides what follows, and must not navigate afterwards: the import
 * may have taken the profile in use, and everything under it.
 */
export function ImportFlow({
  onCancel,
  onDone,
}: {
  /** Back from the first step. */
  onCancel: () => void;
  onDone: (result: { readonly profilesArrived: number }) => void | Promise<void>;
}) {
  const { backup, files } = useServices();
  const { data: current } = useAccount();
  const { data: method } = useOwnerMethod();
  const refresh = useRefreshLocalState();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  // On your server, the owner types its password again: the same check as signing out, which comes first.
  const proofAsks = current?.kind === 'server' && method?.via === 'account' ? method.asks : [];

  const pick = async () => {
    setBusy(true);
    try {
      const file = await files.pick();
      if (file) setStep({ kind: 'key', file });
    } catch (error) {
      setStep({ kind: 'pick', error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const open = async (file: PickedFile) => {
    setBusy(true);
    try {
      setStep({ kind: 'confirm', prepared: await backup.prepareImport(file, key) });
    } catch (error) {
      setStep({ kind: 'key', file, error: error instanceof BackupError ? describeBackupProblem(error.problem) : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const complete = async (prepared: PreparedImport, proof?: Credentials) => {
    setStep({ kind: 'completing' });
    try {
      const result = await backup.completeImport(prepared, proof);
      await refresh({ remote: true });
      await onDone(result);
    } catch (error) {
      const message =
        error instanceof OwnerNotVerifiedError
          ? proofAsks.length > 0
            ? describeProofVerdict(error.verdict)
            : describeOwnerVerdict(error.verdict)
          : error instanceof Error
            ? error.message
            : String(error);
      setStep({ kind: 'confirm', prepared, ...(message ? { error: message } : {}) });
    }
  };

  switch (step.kind) {
    case 'pick':
      return (
        <YStack gap="$5">
          <StepHeading
            title="Restore a backup"
            body="A backup file holds an account — its profiles and PINs, its settings, and its sources with their passwords. Choose one, then type the key it was saved with."
          />
          {step.error ? <SizableText color="$red10">{step.error}</SizableText> : null}
          <XStack gap="$3" items="center">
            <PrimaryButton size="$5" disabled={busy} onPress={() => void pick()}>
              Choose a backup file
            </PrimaryButton>
            {busy ? <Spinner size="small" color="$accent9" /> : null}
          </XStack>
          <BackButton onPress={onCancel} disabled={busy} />
        </YStack>
      );
    case 'key':
      return (
        <YStack gap="$5">
          <StepHeading title="The backup key" body={`Type the key ${step.file.name} was saved with: nine groups of four, as it was shown when it was made.`} />
          <TextInput
            size="$5"
            value={key}
            onChangeText={setKey}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onSubmitEditing={() => void open(step.file)}
            aria-label="Backup key"
          />
          {step.error ? <SizableText color="$red10">{step.error}</SizableText> : null}
          <XStack gap="$3" items="center">
            <PrimaryButton size="$5" disabled={busy || key.trim() === ''} onPress={() => void open(step.file)}>
              Open
            </PrimaryButton>
            {busy ? <Spinner size="small" color="$accent9" /> : null}
          </XStack>
          <BackButton onPress={() => setStep({ kind: 'pick' })} disabled={busy} />
        </YStack>
      );
    case 'confirm': {
      const { prepared } = step;
      const theirs = prepared.profiles.length > 0 ? listAll(prepared.profiles) : 'no profiles';
      const sources = prepared.connections === 1 ? 'one source' : `${prepared.connections} sources`;
      const saved = new Date(prepared.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
      const replaces =
        current?.kind === 'server'
          ? `This device signs out of ${current.name} first, and the backup replaces what it holds. Accounts are never merged.`
          : current
            ? 'It replaces the account on this device, with its profiles and sources. Accounts are never merged.'
            : undefined;
      return (
        <YStack gap="$5">
          <StepHeading title={`Use ${prepared.accountName} on this device?`} body={`Saved ${saved}, with ${theirs} and ${sources}. It becomes an account kept on this device.`} />
          {replaces ? (
            <Paragraph size="$3" color="$color10">
              {replaces}
            </Paragraph>
          ) : null}
          {proofAsks.length > 0 ? (
            <OwnerProofForm
              asks={proofAsks}
              prompt={`The password of ${current?.name ?? 'your account'}`}
              busy={false}
              error={step.error}
              onSubmit={(proof) => void complete(prepared, proof)}
              onCancel={() => setStep({ kind: 'pick' })}
            />
          ) : (
            <>
              {step.error ? <SizableText color="$red10">{step.error}</SizableText> : null}
              <PrimaryButton size="$5" onPress={() => void complete(prepared)}>
                {current ? 'Replace' : 'Restore'}
              </PrimaryButton>
              <BackButton onPress={() => setStep({ kind: 'pick' })} />
            </>
          )}
        </YStack>
      );
    }
    case 'completing':
      return (
        <YStack items="center" gap="$4" py="$8">
          <Spinner size="large" color="$accent9" />
          <SizableText size="$4" color="$color11">
            Restoring…
          </SizableText>
        </YStack>
      );
  }
}

function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <YStack gap="$2">
      <H2 size="$8" color="$color12">
        {title}
      </H2>
      <Paragraph size="$4" color="$color11">
        {body}
      </Paragraph>
    </YStack>
  );
}

function BackButton({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Button chromeless color="$color10" self="flex-start" px={0} disabled={disabled} onPress={onPress}>
      Back
    </Button>
  );
}
