import { declaredRoles, type PluginCategory, type PluginManifest } from '@sc/api';
import { Stack } from 'expo-router';
import { Paragraph, SizableText } from 'tamagui';

import { Chip, ChipRow } from '@/components/chip';
import { CATEGORY_LABELS, CONTENT_KIND_LABELS, ROLE_LABELS } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount } from '@/hooks/use-account';
import { usePluginStates } from '@/hooks/use-plugins';

import { pluginHref } from './plugin-route';

/** What each list holds, and where what is set up in it applies. */
const FOOTERS: Readonly<Record<PluginCategory, string>> = {
  sources: 'Films, series and anime appear on Media; videos and files on Videos. A connection can keep a separate sign-in, or everything, for each profile.',
  iptv: 'Live TV, and a provider’s films and series, appear on TV — never in your library.',
  players: 'Players are set up on each device. Nothing plays yet: playback arrives in a later version of the app.',
  sync: 'Where your account lives — on this device, or on your own server — and where its backups go. Each device chooses its own.',
};

/** Why a list is empty: its plugins do not run here. */
const NONE_HERE: Readonly<Record<PluginCategory, string>> = {
  sources: 'No source runs on this device.',
  iptv: 'IPTV providers can’t be reached from a browser. Add one in the app on your phone or tablet.',
  players: 'No player runs on this device.',
  sync: 'Nothing can keep your account on this device yet.',
};

/** One category's plugins, as they run on this platform. */
export function CategoryScreen({ category }: { category: PluginCategory | undefined }) {
  const { catalog } = useServices();
  const { data: states } = usePluginStates();
  const { data: account } = useAccount();

  if (!category) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Plugins' }} />
        <SizableText color="$color10">There is no such list of plugins.</SizableText>
      </Screen>
    );
  }

  const shown = catalog.inCategory(category);
  return (
    <Screen gap="$4">
      <Stack.Screen options={{ title: CATEGORY_LABELS[category] }} />
      {shown.length > 0 ? (
        <SettingsSection footer={FOOTERS[category]}>
          {shown.map((manifest) => (
            <SettingsRow
              key={manifest.id}
              title={manifest.displayName}
              subtitle={manifest.description}
              trailing={
                account?.connection.pluginId === manifest.id ? (
                  <Chip label="Your account" tone="accent" />
                ) : states?.get(manifest.id)?.enabled ? (
                  <Chip label="Installed" tone="accent" />
                ) : null
              }
              href={pluginHref(manifest.id)}
            />
          ))}
        </SettingsSection>
      ) : (
        <Paragraph color="$color10">{NONE_HERE[category]}</Paragraph>
      )}
    </Screen>
  );
}

/** What a plugin brings and which roles it has, from its manifest. */
export function PluginChips({ manifest }: { manifest: PluginManifest }) {
  return (
    <ChipRow>
      {(manifest.media?.contentKinds ?? []).map((kind) => (
        <Chip key={kind} label={CONTENT_KIND_LABELS[kind]} tone="accent" />
      ))}
      {declaredRoles(manifest).map((role) => (
        <Chip key={role} label={ROLE_LABELS[role]} />
      ))}
    </ChipRow>
  );
}
