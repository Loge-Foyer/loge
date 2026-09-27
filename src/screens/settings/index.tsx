import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { CloudOff } from '@tamagui/lucide-icons-2/icons/CloudOff';
import { Info } from '@tamagui/lucide-icons-2/icons/Info';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { Puzzle } from '@tamagui/lucide-icons-2/icons/Puzzle';
import { Users } from '@tamagui/lucide-icons-2/icons/Users';
import Constants from 'expo-constants';
import { SizableText } from 'tamagui';

import { describeSyncStatus, ROLE_LABELS } from '@/components/labels';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useAccountProviders, useSyncStatus } from '@/hooks/use-account';
import { usePluginStates } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';

/** Every setting lives here: the account, the profile, the device's plugins, and the app itself. */
export function SettingsScreen() {
  const userId = useActiveUserId();
  const { catalog } = useServices();
  const { data: account } = useAccount();
  const { data: providers = [] } = useAccountProviders();
  const status = useSyncStatus();
  const { data: profiles = [] } = useProfiles();
  const { data: states } = usePluginStates();
  const { data: sources = [] } = useSources();
  const user = profiles.find((profile) => profile.id === userId);
  const installed = catalog.list().filter((manifest) => states?.get(manifest.id)?.enabled);

  return (
    <Screen>
      <SettingsSection title="Account">
        <SettingsRow
          title={account ? account.connection.label : 'This device only'}
          subtitle={
            account
              ? describeSyncStatus(status)
              : providers.length > 0
                ? 'Sign in to keep your profiles on every device'
                : 'Your profiles are kept on this device'
          }
          icon={account ? <Cloud size={20} color="$color11" /> : <CloudOff size={20} color="$color11" />}
          href="/settings/account"
        />
      </SettingsSection>

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
        footer="Plugins and their connections belong to the device. A connection can keep a separate sign-in, or everything, for each profile."
      >
        {installed.map((manifest) => {
          const live = sources.filter((source) => source.manifest.id === manifest.id);
          const active = [
            ...(live.some((source) => source.effective.media) ? [ROLE_LABELS.media] : []),
            // The account is a connection too, even when it brings nothing to watch.
            ...(account?.connection.pluginId === manifest.id ? [ROLE_LABELS.sync] : []),
          ];
          return (
            <SettingsRow
              key={manifest.id}
              title={manifest.displayName}
              subtitle={`${live.length} ${live.length === 1 ? 'connection' : 'connections'}${
                active.length > 0 ? ` · ${active.join(' · ')}` : ''
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
