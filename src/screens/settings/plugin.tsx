import type { ConnectionId, PluginId, PluginManifest } from '@sc/api';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Stack } from 'expo-router';
import { Button, Paragraph, SizableText, YStack } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { Chip } from '@/components/chip';
import { ConfirmButton } from '@/components/confirm-button';
import { CONTENT_KIND_LABELS, describeBackupProblem, describeTargetStatus, PER_PROFILE_SUMMARY, TAB_LABELS } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount } from '@/hooks/use-account';
import { useBackupTargetActions, useBackupTargets } from '@/hooks/use-backup';
import { usePlayerActions, usePlayers } from '@/hooks/use-players';
import { usePluginConnections } from '@/hooks/use-connections';
import { usePluginManifest } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { BackupError } from '@/services/backup';
import { CONTENT_TABS, type ContentTab } from '@/services/tab-content';

import { newConnectionHref } from './plugin-route';
import { PluginChips } from './plugins';

/** A route that names no plugin of this app, or one that does not run on this platform. */
export function UnknownPlugin() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Adapter' }} />
      <SizableText color="$color10">This adapter is not part of this app.</SizableText>
    </Screen>
  );
}

export function PluginScreen({ pluginId }: { pluginId: PluginId }) {
  const { catalog } = useServices();
  const manifest = usePluginManifest(pluginId);
  const userId = useActiveUserId();
  const { data: profiles = [] } = useProfiles();
  const { data: account } = useAccount();
  const { data: connections = [] } = usePluginConnections(pluginId);

  if (!manifest) return <UnknownPlugin />;
  // A player, or a place for backups: nothing to connect until its engine or its role exists.
  if (manifest.backup) return <BackupTargetScreen manifest={manifest} />;
  if (manifest.player) return <PlayerScreen manifest={manifest} />;

  const header = (
    <YStack gap="$3">
      <Paragraph size="$5" color="$color11">
        {manifest.description}
      </Paragraph>
      <PluginChips manifest={manifest} />
    </YStack>
  );

  if (manifest.account) {
    const isAccount = account?.kind === 'server' && account.connection.pluginId === pluginId;
    const usable = catalog.accountRole(pluginId) !== undefined;
    return (
      <Screen>
        <Stack.Screen options={{ title: manifest.displayName }} />
        {header}
        <SettingsSection title="Account" footer="Your account keeps your profiles and sources in step on every device signed in to it.">
          {isAccount ? (
            <SettingsRow
              title={account.name}
              subtitle="Your account"
              icon={<Cloud size={18} color="$accent10" />}
              href="/settings/account"
            />
          ) : usable ? (
            <SettingsRow
              title="Use as your account"
              icon={<Cloud size={18} color="$accent10" />}
              href={{ pathname: '/settings/account/sign-in', params: { plugin: pluginId } }}
            />
          ) : (
            <SettingsRow title="Not in this version of the app yet" />
          )}
        </SettingsSection>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: manifest.displayName }} />
      {header}
      <SettingsSection
        title="Connections"
        footer="Every profile of your account sees these connections. Each one decides what a profile keeps for itself — nothing, its own sign-in, or everything."
      >
        {connections.map(({ connection, setUp, off }) => {
          const what = connection.enabled && manifest.media
            ? manifest.media.contentKinds.map((kind) => CONTENT_KIND_LABELS[kind]).join(', ')
            : 'Switched off';
          const who =
            connection.perProfile === 'none'
              ? PER_PROFILE_SUMMARY.none
              : [
                  PER_PROFILE_SUMMARY[connection.perProfile],
                  off.has(userId)
                    ? 'off for you'
                    : setUp.has(userId)
                      ? `${setUp.size} of ${profiles.length - off.size} set up`
                      : 'not set up for you',
                  ...(off.size > 0 && !off.has(userId) ? [`off for ${off.size}`] : []),
                ].join(' · ');
          return (
            <SettingsRow
              key={connection.id}
              title={connection.label}
              subtitle={`${what}\n${who}`}
              href={{ pathname: '/settings/connections/[connectionId]', params: { connectionId: connection.id } }}
            />
          );
        })}
        <SettingsRow title="Add connection" icon={<Plus size={18} color="$accent10" />} href={newConnectionHref(pluginId)} />
      </SettingsSection>
    </Screen>
  );
}

/**
 * A place for the account's backup file, on this device: where it is, how the
 * last save went, Save now — and, when another device changed the file since,
 * the choice of what to keep. Nothing is ever overwritten without asking.
 */
function BackupTargetScreen({ manifest }: { manifest: PluginManifest }) {
  const { data: connections = [] } = usePluginConnections(manifest.id);
  const statuses = useBackupTargets(connections.map(({ connection }) => connection.id));
  const { saveNow, resolve } = useBackupTargetActions();
  const ours = statuses.filter((status) => connections.some(({ connection }) => connection.id === status.connectionId));
  const resolveError = resolve.error
    ? resolve.error instanceof BackupError
      ? resolve.error.problem === 'wrong-key'
        ? 'The backup there was saved with another key. Import it from Settings → Adapters → Sync, with its key.'
        : describeBackupProblem(resolve.error.problem)
      : resolve.error.message
    : undefined;

  const choose = (id: ConnectionId, choice: 'theirs' | 'mine' | 'both') => resolve.mutate({ id, choice });

  return (
    <Screen>
      <Stack.Screen options={{ title: manifest.displayName }} />
      <Paragraph size="$5" color="$color11">
        {manifest.description}
      </Paragraph>
      <SettingsSection
        title="Backups here"
        footer={`${manifest.backup?.location ?? manifest.displayName}. The backup file is saved here as your account changes — the same encrypted file Export makes, which opens only with your backup key.`}
      >
        {connections.map(({ connection }) => {
          const status = ours.find((candidate) => candidate.connectionId === connection.id);
          return (
            <SettingsRow
              key={connection.id}
              title={connection.label}
              {...(status ? { subtitle: describeTargetStatus(status) } : {})}
              href={{ pathname: '/settings/connections/[connectionId]', params: { connectionId: connection.id } }}
            />
          );
        })}
        {connections.length === 0 ? (
          <SettingsRow title={`Save backups to ${manifest.displayName}`} icon={<Plus size={18} color="$accent10" />} href={newConnectionHref(manifest.id)} />
        ) : (
          <SettingsRow title="Save now" icon={<RefreshCw size={18} color="$accent10" />} disabled={saveNow.isPending} onPress={() => saveNow.mutate()} />
        )}
      </SettingsSection>
      {ours
        .filter((status) => status.phase === 'conflict')
        .map((status) => (
          <SettingsSection
            key={status.connectionId}
            title="Changed on another device"
            footer="Another device saved the backup here since this one last did. Nothing was overwritten: choose what to keep."
          >
            <YStack p="$4" gap="$3" items="flex-start" bg="$color2">
              <ConfirmButton
                label="Open the one there"
                title="Open the backup there?"
                description="It replaces this device’s account — its profiles, settings and sources — with the one in the backup."
                confirmLabel="Replace"
                disabled={resolve.isPending}
                onConfirm={() => choose(status.connectionId, 'theirs')}
              />
              <Button disabled={resolve.isPending} onPress={() => choose(status.connectionId, 'mine')}>
                Keep this device’s
              </Button>
              <Button disabled={resolve.isPending} onPress={() => choose(status.connectionId, 'both')}>
                Keep both
              </Button>
              <SizableText size="$2" color="$color10">
                Keep both: this device’s account becomes one of its own, and its backup is saved beside the other.
              </SizableText>
            </YStack>
          </SettingsSection>
        ))}
      {resolveError ? <SizableText color="$red10">{resolveError}</SizableText> : null}
    </Screen>
  );
}

/** A player, on this device: on or off, whether it plays first, and where. Another device chooses its own. */
function PlayerScreen({ manifest }: { manifest: PluginManifest }) {
  const { data: players = [] } = usePlayers();
  const { setEnabled, setPreferred, setFirstOn } = usePlayerActions();
  const player = players.find((candidate) => candidate.manifest.id === manifest.id);
  const firstOn = (tab: ContentTab) => players.find((candidate) => candidate.firstOn.includes(tab));
  return (
    <Screen>
      <Stack.Screen options={{ title: manifest.displayName }} />
      <Paragraph size="$5" color="$color11">
        {manifest.description}
      </Paragraph>
      {player ? (
        <SettingsSection title="On this device" footer="Players are chosen on each device. The one that plays first is asked first; when it can’t play something, the next one that can does.">
          <SettingsRow
            title="On"
            trailing={
              <AppSwitch
                label={`${manifest.displayName} on`}
                checked={player.enabled}
                disabled={setEnabled.isPending}
                onCheckedChange={(enabled) => setEnabled.mutate({ id: manifest.id, enabled })}
              />
            }
          />
          <SettingsRow
            title="Play with it first"
            {...(player.preferred ? { subtitle: 'It plays first on this device' } : {})}
            disabled={player.preferred || setPreferred.isPending}
            onPress={() => setPreferred.mutate(manifest.id)}
          />
          {player.playsHere ? (
            <SettingsRow
              title="Picture in picture"
              subtitle={
                player.canShrink
                  ? 'It can shrink into a floating window when the app is left.'
                  : 'Not with this engine here: its picture never reaches a layer the system can take over. Another player can.'
              }
              trailing={<Chip label={player.canShrink ? 'Yes' : 'No'} {...(player.canShrink ? ({ tone: 'accent' } as const) : {})} />}
            />
          ) : null}
        </SettingsSection>
      ) : null}
      {player?.playsHere ? (
        <SettingsSection title="First on a tab" footer="A tab’s choice goes before the device’s. Channels, and a provider’s films and series, play from TV.">
          {CONTENT_TABS.map((tab) => {
            const other = firstOn(tab);
            return (
              <SettingsRow
                key={tab}
                title={TAB_LABELS[tab]}
                {...(other && other.manifest.id !== manifest.id ? { subtitle: `${other.manifest.displayName} plays first here` } : {})}
                trailing={
                  <AppSwitch
                    label={`${manifest.displayName} first on ${TAB_LABELS[tab]}`}
                    checked={player.firstOn.includes(tab)}
                    disabled={setFirstOn.isPending}
                    onCheckedChange={(first) => setFirstOn.mutate({ id: manifest.id, tab, first })}
                  />
                }
              />
            );
          })}
        </SettingsSection>
      ) : player ? (
        <Paragraph size="$3" color="$color10">
          It has no engine on this device yet, so it never plays here.
        </Paragraph>
      ) : null}
    </Screen>
  );
}
