import type { PluginId } from '@sc/api';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Stack } from 'expo-router';
import { Paragraph, SizableText, YStack } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { CONTENT_KIND_LABELS, PER_PROFILE_SUMMARY, ROLE_LABELS } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { usePluginConnections } from '@/hooks/use-connections';
import { usePluginActions, usePluginManifest, usePluginStates } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { PLUGIN_OFF } from '@/services/device-plugins';

import { PluginChips } from './plugins';

export function PluginScreen({ pluginId }: { pluginId: PluginId }) {
  const manifest = usePluginManifest(pluginId);
  const userId = useActiveUserId();
  const { data: profiles = [] } = useProfiles();
  const state = usePluginStates().data?.get(pluginId) ?? PLUGIN_OFF;
  const { setEnabled } = usePluginActions();
  const { data: connections = [] } = usePluginConnections(pluginId);

  if (!manifest) {
    return (
      <Screen>
        <SizableText color="$color10">This plugin is not part of this app.</SizableText>
      </Screen>
    );
  }

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
          subtitle={state.enabled ? 'Its sources are available' : 'Install to connect a source'}
          trailing={
            <AppSwitch
              label="Installed"
              checked={state.enabled}
              onCheckedChange={(enabled) => setEnabled.mutate({ id: pluginId, enabled })}
            />
          }
        />
      </SettingsSection>

      {state.enabled ? (
        <SettingsSection title="Connections">
          {connections.map(({ connection, setUp, off }) => {
            const roles = (['media', 'sync'] as const).filter((role) => connection.roles[role] === true);
            const what =
              roles.length > 0
                ? roles.map((role) => ROLE_LABELS[role]).join(' · ') +
                  (roles.includes('media') && manifest.media
                    ? ` — ${manifest.media.contentKinds.map((kind) => CONTENT_KIND_LABELS[kind]).join(', ')}`
                    : '')
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
          <SettingsRow
            title="Add connection"
            icon={<Plus size={18} color="$accent10" />}
            href={{ pathname: '/settings/plugins/[pluginId]/new', params: { pluginId } }}
          />
        </SettingsSection>
      ) : null}
    </Screen>
  );
}
