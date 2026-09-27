import { connectionId as toConnectionId, pluginId as toPluginId } from '@sc/api';
import { ArrowLeftRight } from '@tamagui/lucide-icons-2/icons/ArrowLeftRight';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { CloudAlert } from '@tamagui/lucide-icons-2/icons/CloudAlert';
import { KeyRound } from '@tamagui/lucide-icons-2/icons/KeyRound';
import { LogOut } from '@tamagui/lucide-icons-2/icons/LogOut';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Paragraph, SizableText, Spinner, YStack } from 'tamagui';

import { ConfirmButton } from '@/components/confirm-button';
import { describeSyncStatus, SYNC_CAPABILITY_LABELS } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useAccountActions, useAccountProviders, useSyncStatus } from '@/hooks/use-account';
import { OwnerNotVerifiedError } from '@/services/account';
import { SignInFlow, type SignInStart } from '@/screens/sign-in-flow';

/** The device's account: how it stands, what it keeps in step, and switching or signing out. */
export function AccountScreen() {
  const { data: current } = useAccount();
  const { data: providers = [] } = useAccountProviders();
  const status = useSyncStatus();
  const { signOut, syncNow } = useAccountActions();

  if (current === undefined) return <Screen>{null}</Screen>;

  if (current === null) {
    return (
      <Screen>
        <Paragraph color="$color11">
          Your profiles and settings are kept on this device only. Signed in to an account, they are kept in step on every
          device signed in to it.
        </Paragraph>
        {providers.length > 0 ? (
          <SettingsSection>
            <SettingsRow title="Sign in" icon={<Cloud size={20} color="$color11" />} href="/settings/account/sign-in" />
          </SettingsSection>
        ) : (
          <Paragraph size="$2" color="$color10">
            No account can be used in this version of the app yet.
          </Paragraph>
        )}
      </Screen>
    );
  }

  const name = current.connection.label;
  const troubled = status.phase === 'waiting' || status.phase === 'failed' || status.phase === 'needs-sign-in' || status.phase === 'unavailable';
  const busy = status.phase === 'syncing' || syncNow.isPending;
  const signOutError =
    signOut.error instanceof OwnerNotVerifiedError
      ? signOut.error.verdict === 'cancelled'
        ? undefined
        : signOut.error.message
      : signOut.error?.message;

  return (
    <Screen>
      <SettingsSection
        title="Account"
        {...(status.problem && troubled && !status.problem.needsPassword ? { footer: status.problem.message } : {})}
      >
        <SettingsRow
          title={name}
          subtitle={describeSyncStatus(status)}
          icon={troubled ? <CloudAlert size={20} color="$orange10" /> : <Cloud size={20} color="$color11" />}
          trailing={busy ? <Spinner size="small" color="$accent9" /> : null}
        />
        {status.phase === 'needs-sign-in' ? (
          <SettingsRow
            title="Sign in again"
            icon={<KeyRound size={20} color="$color11" />}
            href={{ pathname: '/settings/account/sign-in', params: { again: '1' } }}
          />
        ) : null}
        <SettingsRow
          title="Sync now"
          icon={<RefreshCw size={20} color="$color11" />}
          disabled={busy || !current.available || status.phase === 'needs-sign-in'}
          onPress={() => syncNow.mutate()}
        />
      </SettingsSection>

      <SettingsSection
        title="Kept in step"
        footer="Passwords stay on each device. Another device asks once for a connection’s password."
      >
        {current.carried.size > 0 ? (
          [...current.carried].map((capability) => (
            <SettingsRow key={capability} title={SYNC_CAPABILITY_LABELS[capability]} icon={<Check size={18} color="$accent10" />} />
          ))
        ) : (
          <SettingsRow title="Nothing yet" />
        )}
      </SettingsSection>

      <SettingsSection>
        {current.manifest ? (
          <SettingsRow
            title="Account details"
            subtitle="Its name here, and whether it is a source too"
            href={{ pathname: '/settings/connections/[connectionId]', params: { connectionId: current.connection.id } }}
          />
        ) : null}
        {providers.length > 0 ? (
          <SettingsRow
            title="Switch account"
            subtitle="Move your profiles and settings to another account"
            icon={<ArrowLeftRight size={20} color="$color11" />}
            href={{ pathname: '/settings/account/sign-in', params: { switch: '1' } }}
          />
        ) : null}
      </SettingsSection>

      <YStack gap="$2" items="flex-start">
        <ConfirmButton
          label="Sign out"
          icon={<LogOut size={16} />}
          title={`Sign out of ${name}?`}
          description={`${
            status.pending > 0
              ? `${status.pending} ${status.pending === 1 ? 'change hasn’t' : 'changes haven’t'} reached it yet. `
              : ''
          }Your profiles stay on this device, and other devices keep what they have.`}
          confirmLabel="Sign out"
          disabled={signOut.isPending}
          onConfirm={() => signOut.mutate()}
        />
        {signOutError ? (
          <SizableText size="$2" color="$red10">
            {signOutError}
          </SizableText>
        ) : null}
      </YStack>
    </Screen>
  );
}

/** Signing in, switching, or signing in again — the flow Welcome uses too. */
export function SignInScreen() {
  const params = useLocalSearchParams<{ again?: string; switch?: string; plugin?: string; connection?: string }>();
  const { session } = useServices();
  const start: SignInStart = params.again
    ? { kind: 'again' }
    : params.connection
      ? { kind: 'connection', connectionId: toConnectionId(params.connection) }
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
          // "Use the account's profiles" may have taken the profile in use, and this screen with it.
          if (session.getSnapshot().kind === 'ready') router.back();
        }}
      />
    </Screen>
  );
}
