import { declaredRoles, type PluginManifest } from '@sc/api';
import { router, useLocalSearchParams } from 'expo-router';
import { Paragraph } from 'tamagui';

import { Chip, ChipRow } from '@/components/chip';
import { CONTENT_KIND_LABELS, ROLE_LABELS } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { SourceTabs } from '@/components/source-tabs';
import { useServices } from '@/hooks/services-context';
import { usePluginStates } from '@/hooks/use-plugins';
import { TAB_CONTENT, type ContentTab } from '@/services/tab-content';

type Filter = 'all' | ContentTab | 'sync';

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'media', label: 'For Media' },
  { id: 'videos', label: 'For Videos' },
  { id: 'sync', label: 'Sync' },
];

function matches(manifest: PluginManifest, filter: Filter) {
  if (filter === 'all') return true;
  if (filter === 'sync') return manifest.sync !== undefined;
  return manifest.media?.contentKinds.some((kind) => TAB_CONTENT[filter].includes(kind)) ?? false;
}

/** Every plugin this app ships. Installing one is enabling it on this device. */
export function PluginsScreen() {
  const { catalog } = useServices();
  const { data: states } = usePluginStates();
  const params = useLocalSearchParams<{ for?: string }>();
  const filter = FILTERS.find((candidate) => candidate.id === params.for)?.id ?? 'all';
  const shown = catalog.list().filter((manifest) => matches(manifest, filter));

  return (
    <Screen gap="$4">
      <SourceTabs tabs={FILTERS} selected={filter} onSelect={(id) => router.setParams({ for: id })} />
      <SettingsSection>
        {shown.map((manifest) => (
          <SettingsRow
            key={manifest.id}
            title={manifest.displayName}
            subtitle={manifest.description}
            trailing={states?.get(manifest.id)?.enabled ? <Chip label="Installed" tone="accent" /> : null}
            href={{ pathname: '/settings/plugins/[pluginId]', params: { pluginId: manifest.id } }}
          />
        ))}
      </SettingsSection>
      {shown.length === 0 ? <Paragraph color="$color10">No plugin fits this filter.</Paragraph> : null}
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
