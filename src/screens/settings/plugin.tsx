import type { PluginId } from '@sc/api';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Stack } from 'expo-router';
import { Paragraph, SizableText, YStack } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { CONTENT_KIND_LABELS, ROLE_LABELS } from '@/components/labels';
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
  const profile = useProfiles().data?.find((candidate) => candidate.id === userId);
  const state = usePluginStates().data?.get(pluginId) ?? PLUGIN_OFF;
  const { setEnabled, setPerProfile } = usePluginActions();
  const { data: live } = usePluginConnections(pluginId);

  if (!manifest) {
    return (
      <Screen>
        <SizableText color="$color10">This plugin is not part of this app.</SizableText>
      </Screen>
    );
  }

  const scope = live?.owner.scope === 'user' ? (profile?.name ?? 'This profile') : 'This device';

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
        footer={
          state.perProfile
            ? 'Each profile sets up its own connections — for example, everyone’s own account.'
            : 'One set of connections, shared by every profile on this device.'
        }
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
        <SettingsRow
          title="Configure per profile"
          subtitle={state.perProfile ? 'Every profile has its own' : 'Shared by every profile'}
          disabled={!state.enabled}
          trailing={
            <AppSwitch
              label="Configure per profile"
              checked={state.perProfile}
              disabled={!state.enabled}
              onCheckedChange={(perProfile) => setPerProfile.mutate({ id: pluginId, perProfile })}
            />
          }
        />
      </SettingsSection>

      {state.enabled ? (
        <SettingsSection title={`Connections — ${scope}`}>
          {(live?.connections ?? []).map((connection) => {
            const roles = (['media', 'sync'] as const).filter((role) => connection.roles[role] === true);
            return (
              <SettingsRow
                key={connection.id}
                title={connection.label}
                subtitle={
                  roles.length > 0
                    ? roles.map((role) => ROLE_LABELS[role]).join(' · ') +
                      (roles.includes('media') && manifest.media
                        ? ` — ${manifest.media.contentKinds.map((kind) => CONTENT_KIND_LABELS[kind]).join(', ')}`
                        : '')
                    : 'Switched off'
                }
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
