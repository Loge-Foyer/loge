import { DEFAULT_MAX_PROFILES, pluginId as toPluginId } from '@sc/api';
import { ArrowLeftRight } from '@tamagui/lucide-icons-2/icons/ArrowLeftRight';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { CloudAlert } from '@tamagui/lucide-icons-2/icons/CloudAlert';
import { CloudOff } from '@tamagui/lucide-icons-2/icons/CloudOff';
import { KeyRound } from '@tamagui/lucide-icons-2/icons/KeyRound';
import { LogOut } from '@tamagui/lucide-icons-2/icons/LogOut';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SizableText, Spinner, YStack } from 'tamagui';

import { ConfirmButton } from '@/components/confirm-button';
import { ACCOUNT_HOLDS, describeProofVerdict, describeSyncStatus } from '@/components/labels';
import { OwnerProofForm } from '@/components/owner-proof-form';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useAccountActions, useMaxProfiles, useOwnerMethod, useSyncStatus } from '@/hooks/use-account';
import { OwnerNotVerifiedError } from '@/services/account';
import { SignInFlow, type SignInStart } from '@/screens/sign-in-flow';

/** The device's account: where it lives, how it stands, and moving it to your server or back. */
export function AccountScreen() {
  const { account } = useServices();
  const { data: current } = useAccount();
  const status = useSyncStatus();
  const { signOut, syncNow } = useAccountActions();
  const { data: method } = useOwnerMethod();
  const { data: maxProfiles } = useMaxProfiles();
  const [proving, setProving] = useState(false);
  const servers = account.servers();

  if (current === undefined) return <Screen>{null}</Screen>;

  if (current === null || current.kind === 'local') {
    return (
      <Screen>
        <SettingsSection title="Account" footer={`It holds up to ${maxProfiles ?? DEFAULT_MAX_PROFILES} profiles.`}>
          <SettingsRow title={current?.name ?? 'This device'} subtitle="Kept on this device" icon={<CloudOff size={20} color="$color11" />} />
        </SettingsSection>
        <SettingsSection title="Holds">
          {ACCOUNT_HOLDS.map((line) => (
            <SettingsRow key={line} title={line} icon={<Check size={18} color="$accent10" />} />
          ))}
        </SettingsSection>
        {servers.length > 0 ? (
          <SettingsSection footer="Create an account on your server and this one goes up to it. Sign in to one that exists, and it replaces this one.">
            <SettingsRow title="Sign in to your server" icon={<Cloud size={20} color="$color11" />} href="/settings/account/sign-in" />
          </SettingsSection>
        ) : null}
      </Screen>
    );
  }

  const name = current.name;
  const troubled = status.phase === 'waiting' || status.phase === 'failed' || status.phase === 'needs-sign-in' || status.phase === 'unavailable';
  const busy = status.phase === 'syncing' || syncNow.isPending;
  // The account's own check asks for its password again: typed here, in place of the button.
  const asks = method?.via === 'account' ? method.asks : [];
  const signOutError =
    signOut.error instanceof OwnerNotVerifiedError
      ? proving
        ? describeProofVerdict(signOut.error.verdict)
        : signOut.error.verdict === 'cancelled'
          ? undefined
          : signOut.error.message
      : signOut.error?.message;

  return (
    <Screen>
      <SettingsSection
        title="Account"
        {...(status.problem && troubled && !status.problem.needsPassword ? { footer: status.problem.message } : { footer: `On your server. It holds up to ${current.maxProfiles} profiles.` })}
      >
        <SettingsRow
          title={name}
          subtitle={describeSyncStatus(status)}
          icon={troubled ? <CloudAlert size={20} color="$orange10" /> : <Cloud size={20} color="$color11" />}
          trailing={busy ? <Spinner size="small" color="$accent9" /> : null}
        />
        {status.phase === 'needs-sign-in' ? (
          <SettingsRow title="Sign in again" icon={<KeyRound size={20} color="$color11" />} href={{ pathname: '/settings/account/sign-in', params: { again: '1' } }} />
        ) : null}
        <SettingsRow
          title="Sync now"
          icon={<RefreshCw size={20} color="$color11" />}
          disabled={busy || !current.available || status.phase === 'needs-sign-in'}
          onPress={() => syncNow.mutate()}
        />
      </SettingsSection>

      <SettingsSection title="Kept in step" footer="Your server keeps your sources’ passwords as you typed them: keep it, and its backups, to yourself.">
        {ACCOUNT_HOLDS.map((line) => (
          <SettingsRow key={line} title={line} icon={<Check size={18} color="$accent10" />} />
        ))}
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          title="Switch account"
          subtitle="Another account replaces this one on this device"
          icon={<ArrowLeftRight size={20} color="$color11" />}
          href={{ pathname: '/settings/account/sign-in', params: { switch: '1' } }}
        />
      </SettingsSection>

      <YStack gap="$2" items="flex-start">
        {proving ? (
          <OwnerProofForm
            asks={asks}
            prompt={`Enter the password of ${name} to sign out.`}
            busy={signOut.isPending}
            error={signOutError}
            // Signed out, this screen stays: the next account must not open on this form.
            onSubmit={(proof) => signOut.mutate(proof, { onSuccess: () => setProving(false) })}
            onCancel={() => {
              setProving(false);
              signOut.reset();
            }}
          />
        ) : (
          <>
            <ConfirmButton
              label="Sign out"
              icon={<LogOut size={16} />}
              title={`Sign out of ${name}?`}
              description={`${
                status.pending > 0 ? `${status.pending} ${status.pending === 1 ? 'change hasn’t' : 'changes haven’t'} reached it yet. ` : ''
              }Everything stays on this device, as an account of its own, and other devices keep what they have.`}
              confirmLabel="Sign out"
              disabled={signOut.isPending}
              onConfirm={() => (asks.length > 0 ? setProving(true) : signOut.mutate(undefined))}
            />
            {signOutError ? (
              <SizableText size="$2" color="$red10">
                {signOutError}
              </SizableText>
            ) : null}
          </>
        )}
      </YStack>
    </Screen>
  );
}

/** Signing in, switching, or signing in again — the flow Welcome uses too. */
export function SignInScreen() {
  const params = useLocalSearchParams<{ again?: string; switch?: string; plugin?: string }>();
  const { session } = useServices();
  const start: SignInStart = params.again
    ? { kind: 'again' }
    : params.plugin
      ? { kind: 'plugin', pluginId: toPluginId(params.plugin) }
      : { kind: 'pick' };

  return (
    <Screen>
      <Stack.Screen options={{ title: params.again ? 'Sign in again' : params.switch ? 'Switch account' : 'Sign in' }} />
      <SignInFlow
        start={start}
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
