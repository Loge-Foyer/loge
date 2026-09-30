import type { Credentials } from '@sc/api';
import { Download } from '@tamagui/lucide-icons-2/icons/Download';
import { KeyRound } from '@tamagui/lucide-icons-2/icons/KeyRound';
import { Upload } from '@tamagui/lucide-icons-2/icons/Upload';
import { useMutation } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Paragraph, SizableText, YStack } from 'tamagui';

import { describeOwnerVerdict, describeProofVerdict } from '@/components/labels';
import { OwnerProofForm } from '@/components/owner-proof-form';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useOwnerMethod } from '@/hooks/use-account';
import { OwnerNotVerifiedError } from '@/services/account';

import { ImportFlow } from '../import-flow';

/** Export, import and the key, in Settings → Plugins → Sync: the backup file needs no plugin. */
export function BackupSection() {
  const { backup, files } = useServices();
  const exporting = useMutation({
    mutationFn: async () => {
      const file = await backup.exportFile();
      return { name: file.name, outcome: await files.save(file.name, file.bytes) };
    },
  });
  const exported = exporting.data?.outcome === 'saved' ? exporting.data.name : undefined;
  return (
    <SettingsSection
      title="Backup file"
      footer="One encrypted file with your whole account — its profiles and PINs, settings, and sources with their passwords. It opens only with its key; keep the key somewhere safe."
    >
      <SettingsRow
        title="Export a backup"
        {...(exporting.isPending
          ? { subtitle: 'Preparing…' }
          : exporting.error
            ? { subtitle: exporting.error.message }
            : exported
              ? { subtitle: exported }
              : {})}
        icon={<Download size={18} color="$accent10" />}
        disabled={exporting.isPending}
        onPress={() => exporting.mutate()}
      />
      <SettingsRow title="Import a backup" icon={<Upload size={18} color="$accent10" />} href="/settings/backup/import" />
      <SettingsRow title="Show the backup key" icon={<KeyRound size={18} color="$accent10" />} href="/settings/backup/key" />
    </SettingsSection>
  );
}

/** Importing from Settings. The flow never navigates after it: the import may have taken the profile in use. */
export function ImportBackupScreen() {
  const { session } = useServices();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Import a backup' }} />
      <ImportFlow
        onCancel={() => router.back()}
        onDone={async () => {
          await session.refresh();
          // A replace may have taken the profile in use, and this screen with it.
          if (session.getSnapshot().kind === 'ready') router.back();
        }}
      />
    </Screen>
  );
}

/**
 * The backup key, after the owner check: it opens every password in every
 * backup this device saves. On your server the check is its password, typed
 * again; otherwise the device asks, and where nothing can ask, it is shown.
 */
export function BackupKeyScreen() {
  const { backup } = useServices();
  const { data: current } = useAccount();
  const { data: method } = useOwnerMethod();
  const [key, setKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const asks = current?.kind === 'server' && method?.via === 'account' ? method.asks : [];

  const show = async (proof?: Credentials) => {
    setBusy(true);
    setError(undefined);
    try {
      setKey(await backup.showKey(proof));
    } catch (failure) {
      setError(
        failure instanceof OwnerNotVerifiedError
          ? asks.length > 0
            ? describeProofVerdict(failure.verdict)
            : describeOwnerVerdict(failure.verdict)
          : failure instanceof Error
            ? failure.message
            : String(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Backup key' }} />
      <Paragraph size="$4" color="$color11">
        The key opens every backup this device saves, and every password in them. Write it down and keep it somewhere safe: without it a backup can’t
        be opened — by anyone, this app included.
      </Paragraph>
      {key ? (
        <YStack gap="$3" p="$4" rounded="$6" borderWidth={1} borderColor="$borderColor" bg="$color2">
          {groupsOf(key).map((line) => (
            <SizableText key={line} size="$7" letterSpacing={2} color="$color12" selectable text="center">
              {line}
            </SizableText>
          ))}
        </YStack>
      ) : asks.length > 0 ? (
        <OwnerProofForm
          asks={asks}
          prompt={`The password of ${current?.name ?? 'your account'}`}
          busy={busy}
          error={error}
          onSubmit={(proof) => void show(proof)}
          onCancel={() => router.back()}
        />
      ) : (
        <YStack gap="$3" items="flex-start">
          {error ? <SizableText color="$red10">{error}</SizableText> : null}
          <PrimaryButton size="$4" disabled={busy} onPress={() => void show()}>
            Show the key
          </PrimaryButton>
        </YStack>
      )}
    </Screen>
  );
}

/** Nine groups of four, three to a line: easier to copy out by hand. */
function groupsOf(key: string): readonly string[] {
  const groups = key.split('-');
  const lines: string[] = [];
  for (let at = 0; at < groups.length; at += 3) lines.push(groups.slice(at, at + 3).join(' '));
  return lines;
}
