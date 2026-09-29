import { PLUGIN_CATEGORIES, type PluginCategory } from '@sc/api';
import { CirclePlay } from '@tamagui/lucide-icons-2/icons/CirclePlay';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { CloudOff } from '@tamagui/lucide-icons-2/icons/CloudOff';
import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Info } from '@tamagui/lucide-icons-2/icons/Info';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { Users } from '@tamagui/lucide-icons-2/icons/Users';
import Constants from 'expo-constants';
import { SizableText } from 'tamagui';

import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, describeSyncStatus } from '@/components/labels';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useAccountProviders, useSyncStatus } from '@/hooks/use-account';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';

import { categoryHref } from './plugin-route';

const CATEGORY_ICONS: Readonly<Record<PluginCategory, typeof Film>> = {
  sources: Film,
  iptv: Tv,
  players: CirclePlay,
  sync: RefreshCw,
};

/** Every setting lives here: the account, the profile, the device's plugins, and the app itself. */
export function SettingsScreen() {
  const userId = useActiveUserId();
  const { catalog } = useServices();
  const { data: account } = useAccount();
  const { data: providers = [] } = useAccountProviders();
  const status = useSyncStatus();
  const { data: profiles = [] } = useProfiles();
  const { data: sources = [] } = useSources();
  const user = profiles.find((profile) => profile.id === userId);

  /** A list's line: what is set up in it, or what it is for. */
  const summaryOf = (category: PluginCategory) => {
    if (category === 'sync') return account ? `Your account: ${account.connection.label}` : CATEGORY_DESCRIPTIONS.sync;
    if (catalog.inCategory(category).length === 0) return 'None on this device';
    const connected = sources.filter((source) => source.manifest.category === category).length;
    if (connected === 0) return CATEGORY_DESCRIPTIONS[category];
    return `${connected} ${connected === 1 ? 'connection' : 'connections'}`;
  };

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
        footer="Sources and IPTV go with your account. Players, and where your account and its backups live, are set up on each device."
      >
        {PLUGIN_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <SettingsRow
              key={category}
              title={CATEGORY_LABELS[category]}
              subtitle={summaryOf(category)}
              icon={<Icon size={20} color="$color11" />}
              href={categoryHref(category)}
            />
          );
        })}
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
