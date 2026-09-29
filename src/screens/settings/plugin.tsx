import type { PluginId, PluginManifest } from '@sc/api';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Stack } from 'expo-router';
import { Paragraph, SizableText, YStack } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { CONTENT_KIND_LABELS, PER_PROFILE_SUMMARY, ROLE_LABELS } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { usePluginConnections } from '@/hooks/use-connections';
import { usePluginActions, usePluginManifest, usePluginStates } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { PLUGIN_OFF } from '@/services/device-plugins';

import { newConnectionHref } from './plugin-route';
import { PluginChips } from './plugins';

/** A route that names no plugin of this app, or one that does not run on this platform. */
export function UnknownPlugin() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Plugin' }} />
      <SizableText color="$color10">This plugin is not part of this app.</SizableText>
    </Screen>
  );
}

export function PluginScreen({ pluginId }: { pluginId: PluginId }) {
  const { catalog } = useServices();
  const manifest = usePluginManifest(pluginId);
  const userId = useActiveUserId();
  const { data: profiles = [] } = useProfiles();
  const state = usePluginStates().data?.get(pluginId) ?? PLUGIN_OFF;
  const { setEnabled } = usePluginActions();
  const { data: connections = [] } = usePluginConnections(pluginId);

  if (!manifest) return <UnknownPlugin />;
  // A player, or a place for backups: nothing to install or connect until its engine or its role exists.
  if (manifest.player || manifest.backup) return <NotYet manifest={manifest} />;

  // Signing in installed the account's plugin, and it stays installed while it is the account.
  const hostsAccount = connections.some((summary) => summary.isAccount);
  const canBeAccount = catalog.syncRole(pluginId) !== undefined;

  return (
    <Screen>
      <Stack.Screen options={{ title: manifest.displayName }} />
      <YStack gap="$3">
        <Paragraph size="$5" color="$color11">
          {manifest.description}
        </Paragraph>
        <PluginChips manifest={manifest} />
      </YStack>

      <SettingsSection
        title="On this device"
        footer="Installed for the whole device. Each connection decides what every profile keeps for itself — nothing, its own sign-in, or everything."
      >
        <SettingsRow
          title="Installed"
          subtitle={
            hostsAccount
              ? 'Your account uses it — sign out to uninstall'
              : !manifest.media
                ? 'Installed when you sign in to it'
                : state.enabled
                  ? 'Its sources are available'
                  : 'Install to connect a source'
          }
          trailing={
            <AppSwitch
              label="Installed"
              checked={state.enabled}
              disabled={hostsAccount}
              onCheckedChange={(enabled) => setEnabled.mutate({ id: pluginId, enabled })}
            />
          }
        />
      </SettingsSection>

      {!manifest.media && !hostsAccount ? (
        canBeAccount ? (
          <SettingsSection title="Account" footer="An account keeps your profiles and settings in step on every device.">
            <SettingsRow
              title="Use as your account"
              icon={<Cloud size={18} color="$accent10" />}
              href={{ pathname: '/settings/account/sign-in', params: { plugin: pluginId } }}
            />
          </SettingsSection>
        ) : (
          <Paragraph size="$3" color="$color10">
            {`${manifest.displayName} can’t carry anything yet: it becomes an account in a later version of the app.`}
          </Paragraph>
        )
      ) : null}

      {state.enabled && (manifest.media || connections.length > 0) ? (
        <SettingsSection title="Connections">
          {connections.map(({ connection, isAccount, setUp, off }) => {
            const what =
              [
                connection.roles.media === true && manifest.media
                  ? `${ROLE_LABELS.media} — ${manifest.media.contentKinds.map((kind) => CONTENT_KIND_LABELS[kind]).join(', ')}`
                  : undefined,
                isAccount ? 'Your account' : undefined,
              ]
                .filter((part) => part !== undefined)
                .join(' · ') || 'Switched off';
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
          {manifest.media ? (
            <SettingsRow
              title="Add connection"
              icon={<Plus size={18} color="$accent10" />}
              href={newConnectionHref(pluginId)}
            />
          ) : null}
        </SettingsSection>
      ) : null}
    </Screen>
  );
}

function NotYet({ manifest }: { manifest: PluginManifest }) {
  return (
    <Screen>
      <Stack.Screen options={{ title: manifest.displayName }} />
      <YStack gap="$3">
        <Paragraph size="$5" color="$color11">
          {manifest.description}
        </Paragraph>
        <Paragraph size="$3" color="$color10">
          {manifest.player
            ? 'Nothing plays yet: playback arrives in a later version of the app.'
            : 'Backups arrive in a later version of the app.'}
        </Paragraph>
      </YStack>
    </Screen>
  );
}
