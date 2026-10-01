import { PLUGIN_CATEGORIES, type PluginCategory } from '@sc/api';
import { CirclePlay } from '@tamagui/lucide-icons-2/icons/CirclePlay';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { Download } from '@tamagui/lucide-icons-2/icons/Download';
import { CloudOff } from '@tamagui/lucide-icons-2/icons/CloudOff';
import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Info } from '@tamagui/lucide-icons-2/icons/Info';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { Users } from '@tamagui/lucide-icons-2/icons/Users';
import Constants from 'expo-constants';
import { SizableText } from 'tamagui';

import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, describeSyncStatus, fileSize } from '@/components/labels';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/screen';
import { AppSwitch } from '@/components/app-switch';
import { useDownloadBudget } from '@/hooks/use-downloads';
import type { DownloadBudget } from '@/services/downloads';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useMaxProfiles, useSyncStatus } from '@/hooks/use-account';
import { useAppSettingActions, useAppSettings } from '@/hooks/use-app-settings';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';
import { APP_DEFAULTS } from '@/services/app-settings';

import { categoryHref } from './plugin-route';

const CATEGORY_ICONS: Readonly<Record<PluginCategory, typeof Film>> = {
  sources: Film,
  iptv: Tv,
  players: CirclePlay,
  sync: RefreshCw,
};

/** Every setting lives here: the account, the profile, the device's plugins, and the app itself. */
export function SettingsScreen() {
  const budget = useDownloadBudget();
  const userId = useActiveUserId();
  const { catalog } = useServices();
  const { data: account } = useAccount();
  const { data: maxProfiles } = useMaxProfiles();
  const status = useSyncStatus();
  const { data: profiles = [] } = useProfiles();
  const { data: sources = [] } = useSources();
  const user = profiles.find((profile) => profile.id === userId);
  const appSettings = useAppSettings();
  const { set } = useAppSettingActions();
  // While it is being read, show the default rather than a switch that flicks.
  const forceLandscape = appSettings.data?.forceLandscape ?? APP_DEFAULTS.forceLandscape;

  /** A list's line: what is set up in it, or what it is for. */
  const summaryOf = (category: PluginCategory) => {
    if (category === 'sync') return account?.kind === 'server' ? `Your account: ${account.name}` : CATEGORY_DESCRIPTIONS.sync;
    if (catalog.inCategory(category).length === 0) return 'None on this device';
    const connected = sources.filter((source) => source.manifest.category === category).length;
    if (connected === 0) return CATEGORY_DESCRIPTIONS[category];
    return `${connected} ${connected === 1 ? 'connection' : 'connections'}`;
  };

  return (
    <Screen>
      <SettingsSection title="Account">
        <SettingsRow
          title={account?.name ?? 'This device'}
          subtitle={account?.kind === 'server' ? describeSyncStatus(status) : 'Kept on this device'}
          icon={account?.kind === 'server' ? <Cloud size={20} color="$color11" /> : <CloudOff size={20} color="$color11" />}
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
          subtitle={`${profiles.length} of ${maxProfiles ?? profiles.length}`}
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

      <SettingsSection title="App" footer="How this device behaves. Each device chooses for itself.">
        <SettingsRow
          title="Force landscape on playback"
          subtitle={forceLandscape ? 'The player turns the phone on its side and holds it there' : 'The player turns with the phone'}
          trailing={
            <AppSwitch
              label="Force landscape on playback"
              checked={forceLandscape}
              disabled={appSettings.data === undefined || set.isPending}
              onCheckedChange={(next) => set.mutate({ forceLandscape: next })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Downloads" footer="What this device keeps to watch with no network at all.">
        <SettingsRow
          title="Downloads"
          subtitle={downloadsSummary(budget.data)}
          icon={<Download size={20} color="$color11" />}
          href="/settings/downloads"
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

/** How full this device is, in the fewest words. */
function downloadsSummary(budget: DownloadBudget | undefined): string {
  if (!budget) return 'What this device keeps';
  if (budget.limitBytes === 0) return 'Not available in a browser';
  const used = fileSize(budget.usedBytes) ?? '0 B';
  const limit = fileSize(budget.limitBytes) ?? '—';
  return budget.full ? `Full — ${used} of ${limit}` : `${used} of ${limit}`;
}
