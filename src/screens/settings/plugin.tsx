import type { PluginId, PluginManifest } from '@sc/api';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Stack } from 'expo-router';
import { Paragraph, SizableText, YStack } from 'tamagui';

import { CONTENT_KIND_LABELS, PER_PROFILE_SUMMARY } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount } from '@/hooks/use-account';
import { usePluginConnections } from '@/hooks/use-connections';
import { usePluginManifest } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';

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
  const { data: account } = useAccount();
  const { data: connections = [] } = usePluginConnections(pluginId);

  if (!manifest) return <UnknownPlugin />;
  // A player, or a place for backups: nothing to connect until its engine or its role exists.
  if (manifest.player || manifest.backup) return <NotYet manifest={manifest} />;

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
