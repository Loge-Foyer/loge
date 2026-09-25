import { Info } from '@tamagui/lucide-icons-2/icons/Info';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { Puzzle } from '@tamagui/lucide-icons-2/icons/Puzzle';
import { Users } from '@tamagui/lucide-icons-2/icons/Users';
import Constants from 'expo-constants';
import { SizableText } from 'tamagui';

import { ROLE_LABELS } from '@/components/labels';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { usePluginStates } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';

/** Every setting lives here: the profile, the device's plugins, and the app itself. */
export function SettingsScreen() {
  const userId = useActiveUserId();
  const { catalog } = useServices();
  const { data: profiles = [] } = useProfiles();
  const { data: states } = usePluginStates();
  const { data: sources = [] } = useSources();
  const user = profiles.find((profile) => profile.id === userId);
  const installed = catalog.list().filter((manifest) => states?.get(manifest.id)?.enabled);

  return (
    <Screen>
      <SettingsSection title="Profile">
        <SettingsRow
          title={user?.name ?? 'Profile'}
          subtitle="Switch profile"
          icon={user ? <ProfileAvatar user={user} size={36} /> : null}
          href="/who-is-watching"
        />
        <SettingsRow
          title="Profiles"
          subtitle={`${profiles.length} on this device`}
          icon={<Users size={20} color="$color11" />}
          href="/settings/profiles"
        />
        <SettingsRow
          title="PIN lock"
          subtitle={user?.pinProtected ? 'On — this profile asks for its PIN' : 'Off'}
          icon={<Lock size={20} color="$color11" />}
          href="/settings/pin"
        />
      </SettingsSection>

      <SettingsSection
        title="Plugins"
        footer="Plugins are installed for the whole device. Their connections are shared by every profile, unless a plugin is set to be configured per profile."
      >
        {installed.map((manifest) => {
          const live = sources.filter((source) => source.manifest.id === manifest.id);
          const active = live.flatMap((source) => [
            ...(source.effective.media ? [ROLE_LABELS.media] : []),
            ...(source.effective.sync ? [ROLE_LABELS.sync] : []),
          ]);
          return (
            <SettingsRow
              key={manifest.id}
              title={manifest.displayName}
              subtitle={`${live.length} ${live.length === 1 ? 'connection' : 'connections'}${
                active.length > 0 ? ` · ${[...new Set(active)].join(' · ')}` : ''
              }`}
              href={{ pathname: '/settings/plugins/[pluginId]', params: { pluginId: manifest.id } }}
            />
          );
        })}
        <SettingsRow
          title={installed.length > 0 ? 'All plugins' : 'Install a plugin'}
          subtitle={`${catalog.list().length} available`}
          icon={<Puzzle size={20} color="$color11" />}
          href="/settings/plugins"
        />
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsRow
          title="Version"
          icon={<Info size={20} color="$color11" />}
          trailing={<SizableText color="$color10">{Constants.expoConfig?.version ?? '—'}</SizableText>}
        />
      </SettingsSection>
    </Screen>
  );
}
