import { PLUGIN_CATEGORIES, type PluginCategory } from '@loge/api';
import { CirclePlay } from '@tamagui/lucide-icons-2/icons/CirclePlay';
import { Cloud } from '@tamagui/lucide-icons-2/icons/Cloud';
import { Download } from '@tamagui/lucide-icons-2/icons/Download';
import { CloudOff } from '@tamagui/lucide-icons-2/icons/CloudOff';
import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Info } from '@tamagui/lucide-icons-2/icons/Info';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { ScanSearch } from '@tamagui/lucide-icons-2/icons/ScanSearch';
import { SlidersHorizontal } from '@tamagui/lucide-icons-2/icons/SlidersHorizontal';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { Users } from '@tamagui/lucide-icons-2/icons/Users';
import Constants from 'expo-constants';
import { SizableText } from 'tamagui';

import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, describePinStatus, describeSyncStatus, fileSize, TAB_LABELS } from '@/components/labels';
import { ProfileAvatar } from '@/components/profile-avatar';
import { isTV } from '@/components/remote';
import { Screen } from '@/components/screen';
import { AppSwitch } from '@/components/app-switch';
import { useDownloadBudget, useDownloadSettings } from '@/hooks/use-downloads';
import type { DownloadBudget } from '@/services/downloads';
import { ChoiceRow, LinkRow, SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useMaxProfiles, useSyncStatus } from '@/hooks/use-account';
import { useConnectedPlugins } from '@/hooks/use-connections';
import { useAccountSettingActions, useWatchStatusSetting } from '@/hooks/use-account-settings';
import { useAppSettingActions, useAppSettings } from '@/hooks/use-app-settings';
import { usePinStatus } from '@/hooks/use-pin';
import { useDefaultUserId, useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { useSources } from '@/hooks/use-sources';
import { WATCH_STATUS_DEFAULTS } from '@/services/account-settings';
import { APP_DEFAULTS } from '@/services/app-settings';
import { APPEARANCES, BUTTON_LABELS, type AppearanceSetting, type ButtonLabels } from '@/services/ports';
import { CONTENT_TABS, type ContentTab } from '@/services/tab-content';

import { BufferingRows } from './buffering';
import { downloadOptionsSummary } from './download-options';
import { categoryHref } from './plugin-route';

/** What each tab's switch keeps watch status for. */
const WATCH_STATUS_ROWS: Readonly<Record<ContentTab, { readonly title: string; readonly subtitle: string }>> = {
  media: { title: 'Media', subtitle: 'Films and series from a source that keeps none' },
  videos: { title: 'Videos', subtitle: 'Web videos and files: where you got to' },
  tv: { title: 'TV films & series', subtitle: 'An IPTV provider’s — never live channels' },
};

const BUTTON_LABEL_NAMES: Readonly<Record<ButtonLabels, string>> = {
  symbols: 'Symbols',
  symbolsAndText: 'Symbols and text',
};

const APPEARANCE_NAMES: Readonly<Record<AppearanceSetting, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const CATEGORY_ICONS: Readonly<Record<PluginCategory, typeof Film>> = {
  sources: Film,
  iptv: Tv,
  players: CirclePlay,
  sync: RefreshCw,
  metadata: ScanSearch,
};

/** Every setting lives here: the account, the profile, the device's plugins, and the app itself. */
export function SettingsScreen() {
  const budget = useDownloadBudget();
  const downloadSettings = useDownloadSettings();
  const userId = useActiveUserId();
  const { catalog } = useServices();
  const { data: account } = useAccount();
  const { data: maxProfiles } = useMaxProfiles();
  const status = useSyncStatus();
  const { data: profiles = [] } = useProfiles();
  const { data: sources = [] } = useSources();
  const { data: connectedPlugins } = useConnectedPlugins();
  const user = profiles.find((profile) => profile.id === userId);
  const pin = usePinStatus(userId);
  const appSettings = useAppSettings();
  const { set } = useAppSettingActions();
  const { data: defaultUserId } = useDefaultUserId();
  // While it is being read, show the default rather than a switch that flicks.
  const forceLandscape = appSettings.data?.forceLandscape ?? APP_DEFAULTS.forceLandscape;
  const openOn = appSettings.data?.openOn ?? APP_DEFAULTS.openOn;
  const asks = appSettings.data?.alwaysChooseProfile;
  const watchStatus = useWatchStatusSetting();
  const { setWatchStatus } = useAccountSettingActions();
  const buttonLabels = appSettings.data?.buttonLabels ?? APP_DEFAULTS.buttonLabels;
  const appearance = appSettings.data?.appearance ?? APP_DEFAULTS.appearance;
  const defaultProfile = profiles.find((profile) => profile.id === defaultUserId);

  /** A list's line: what is set up in it, or what it is for. */
  const summaryOf = (category: PluginCategory) => {
    if (category === 'sync') return account?.kind === 'server' ? `Your account: ${account.name}` : CATEGORY_DESCRIPTIONS.sync;
    if (catalog.inCategory(category).length === 0) return 'None on this device';
    if (category === 'metadata') {
      const used = catalog.inCategory(category).filter((manifest) => connectedPlugins?.has(manifest.id));
      return used.length === 0 ? CATEGORY_DESCRIPTIONS.metadata : used.map((manifest) => manifest.displayName).join(', ');
    }
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
          subtitle={pin.data ? describePinStatus(pin.data) : user?.pinProtected ? 'On' : 'Off'}
          icon={<Lock size={20} color="$color11" />}
          href="/settings/pin"
        />
      </SettingsSection>

      <SettingsSection
        title="Watch status"
        footer="Kept with your account, for each profile, on every device. A source that keeps its own — a media server — keeps it there."
      >
        {CONTENT_TABS.map((tab) => (
          <SettingsRow
            key={tab}
            title={WATCH_STATUS_ROWS[tab].title}
            subtitle={WATCH_STATUS_ROWS[tab].subtitle}
            trailing={
              <AppSwitch
                label={`Keep watch status on ${WATCH_STATUS_ROWS[tab].title}`}
                checked={(watchStatus.data ?? WATCH_STATUS_DEFAULTS)[tab]}
                disabled={watchStatus.data === undefined || setWatchStatus.isPending}
                onCheckedChange={(next) => setWatchStatus.mutate({ [tab]: next })}
              />
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection title="App" footer="How this device behaves. Each device chooses for itself.">
        <ChoiceRow
          title="Appearance"
          subtitle="Light or dark, or as this device is set"
          options={APPEARANCES}
          label={(option) => APPEARANCE_NAMES[option]}
          value={appearance}
          disabled={appSettings.data === undefined || set.isPending}
          onChoose={(option) => set.mutate({ appearance: option })}
        />
        <ChoiceRow
          title="Open on"
          subtitle="The tab the app starts on"
          options={CONTENT_TABS}
          label={(tab) => TAB_LABELS[tab]}
          value={openOn}
          disabled={appSettings.data === undefined || set.isPending}
          onChoose={(tab) => set.mutate({ openOn: tab })}
        />
        <SettingsRow
          title="Always show profile selector"
          subtitle={
            asks
              ? 'Asks who’s watching every time the app starts'
              : `Opens ${defaultProfile ? defaultProfile.name : 'the default profile'} when the app starts`
          }
          trailing={
            <AppSwitch
              label="Always show profile selector"
              checked={asks ?? false}
              disabled={asks === undefined || set.isPending}
              onCheckedChange={(next) => set.mutate({ alwaysChooseProfile: next })}
            />
          }
        />
        {isTV ? null : (
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
        )}
        <ChoiceRow
          title="Buttons"
          subtitle="On a title's page: Play, watched and the rest"
          options={BUTTON_LABELS}
          label={(option) => BUTTON_LABEL_NAMES[option]}
          value={buttonLabels}
          disabled={appSettings.data === undefined || set.isPending}
          onChoose={(option) => set.mutate({ buttonLabels: option })}
        />
        <BufferingRows />
      </SettingsSection>

      <SettingsSection title="Downloads" footer="What this device keeps to watch with no network at all.">
        {/* Where nothing can be kept — a TV, a browser — there is nothing to ask for. */}
        {budget.data?.limitBytes === 0 ? null : (
          <SettingsRow
            title="Options"
            subtitle={downloadOptionsSummary(downloadSettings.data)}
            icon={<SlidersHorizontal size={20} color="$color11" />}
            href="/settings/downloads/options"
          />
        )}
        <SettingsRow
          title="Downloads"
          subtitle={downloadsSummary(budget.data)}
          icon={<Download size={20} color="$color11" />}
          href="/settings/downloads"
        />
      </SettingsSection>

      <SettingsSection
        title="Adapters"
        footer="Sources, IPTV and metadata go with your account. Players, and where your account and its backups live, are set up on each device."
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
        {/* The AGPL owes whoever uses a copy its source, and NOTICE asks every copy to keep this attribution. What each adapter is built on — and what a service asks the app to say — is on that adapter's own page, under Credits. */}
        <LinkRow title="Loge" note="Free software, under the GNU AGPL 3.0 or later." url="https://github.com/Loge-Foyer/loge" />
      </SettingsSection>
    </Screen>
  );
}

/** How full this device is, in the fewest words. */
function downloadsSummary(budget: DownloadBudget | undefined): string {
  if (!budget) return 'What this device keeps';
  if (budget.limitBytes === 0) return 'Not available on this device';
  const used = fileSize(budget.usedBytes) ?? '0 B';
  const limit = fileSize(budget.limitBytes) ?? '—';
  return budget.full ? `Full — ${used} of ${limit}` : `${used} of ${limit}`;
}
