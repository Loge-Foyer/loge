import type { PluginCategory, PluginId, PluginManifest } from '@sc/api';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { ChevronUp } from '@tamagui/lucide-icons-2/icons/ChevronUp';
import { Stack } from 'expo-router';
import { Button, Paragraph, SizableText, XStack } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { Chip, ChipRow } from '@/components/chip';
import { CATEGORY_LABELS, CONTENT_KIND_LABELS, TAB_LABELS } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount } from '@/hooks/use-account';
import { useConnectedPlugins } from '@/hooks/use-connections';
import { useAppSettingActions, useAppSettings } from '@/hooks/use-app-settings';
import { usePlayerActions, usePlayers } from '@/hooks/use-players';
import { APP_DEFAULTS, SEEK_CHOICES } from '@/services/app-settings';
import { PLAYER_BUTTONS, type PlayerButton } from '@/services/ports';
import type { PlayerSummary } from '@/services/players';

import { BackupSection } from './backup';
import { pluginHref } from './plugin-route';

/** What each list holds, and where what is set up in it applies. */
const FOOTERS: Readonly<Record<PluginCategory, string>> = {
  sources: 'Films, series and anime appear on Media; videos and files on Videos. A connection can keep a separate sign-in, or everything, for each profile.',
  iptv: 'Live TV, and a provider’s films and series, appear on TV — never in your library.',
  players: 'Players are set up on each device: which are on, and which plays first. Move one up to try it before the others.',
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
  const { data: connected } = useConnectedPlugins();
  const { data: account } = useAccount();
  const { data: players = [] } = usePlayers();
  const { move } = usePlayerActions();

  if (!category) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Plugins' }} />
        <SizableText color="$color10">There is no such list of plugins.</SizableText>
      </Screen>
    );
  }

  // Players are listed in this device's own order, which is also the order
  // they are tried in; every other category keeps the catalogue's.
  const shown: readonly PluginManifest[] = category === 'players' ? players.map((player) => player.manifest) : catalog.inCategory(category);
  const orderable = category === 'players' && shown.length > 1;
  return (
    <Screen gap="$4">
      <Stack.Screen options={{ title: CATEGORY_LABELS[category] }} />
      {shown.length > 0 ? (
        <SettingsSection footer={FOOTERS[category]}>
          {shown.map((manifest, index) => (
            <SettingsRow
              key={manifest.id}
              title={manifest.displayName}
              subtitle={manifest.description}
              trailing={
                <XStack items="center" gap="$2">
                  {account?.kind === 'server' && account.connection.pluginId === manifest.id ? (
                    <Chip label="Your account" tone="accent" />
                  ) : connected?.has(manifest.id) ? (
                    <Chip label="Connected" tone="accent" />
                  ) : manifest.player ? (
                    <PlayerChip state={players.find((player) => player.manifest.id === manifest.id)} />
                  ) : null}
                  {orderable ? <Reorder id={manifest.id} index={index} count={shown.length} disabled={move.isPending} onMove={move.mutate} /> : null}
                </XStack>
              }
              href={pluginHref(manifest.id)}
            />
          ))}
        </SettingsSection>
      ) : (
        <Paragraph color="$color10">{NONE_HERE[category]}</Paragraph>
      )}
      {category === 'players' ? <PlayerControlsSection /> : null}
      {category === 'sync' ? <BackupSection /> : null}
    </Screen>
  );
}

/** Plays first, or first on a tab, is switched off, or cannot play here yet. */
function PlayerChip({ state }: { state: PlayerSummary | undefined }) {
  if (!state) return null;
  if (!state.playsHere) return <Chip label="Not here yet" />;
  if (!state.enabled) return <Chip label="Off" />;
  if (state.preferred) return <Chip label="Plays first" tone="accent" />;
  return state.firstOn.length > 0 ? <Chip label={`First on ${state.firstOn.map((tab) => TAB_LABELS[tab]).join(', ')}`} tone="accent" /> : null;
}

/** What a plugin brings, from its manifest. */
export function PluginChips({ manifest }: { manifest: PluginManifest }) {
  const kinds = manifest.media?.contentKinds ?? [];
  if (kinds.length === 0) return null;
  return (
    <ChipRow>
      {kinds.map((kind) => (
        <Chip key={kind} label={CONTENT_KIND_LABELS[kind]} tone="accent" />
      ))}
    </ChipRow>
  );
}

/** Moves a player up or down this device's order. The ends are inert, and say so by being disabled. */
function Reorder({
  id,
  index,
  count,
  disabled,
  onMove,
}: {
  id: PluginId;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (move: { id: PluginId; by: -1 | 1 }) => void;
}) {
  return (
    <XStack gap="$1">
      <Button
        size="$2"
        chromeless
        circular
        icon={ChevronUp}
        aria-label="Move up"
        disabled={disabled || index === 0}
        opacity={index === 0 ? 0.3 : 1}
        onPress={() => onMove({ id, by: -1 })}
      />
      <Button
        size="$2"
        chromeless
        circular
        icon={ChevronDown}
        aria-label="Move down"
        disabled={disabled || index === count - 1}
        opacity={index === count - 1 ? 0.3 : 1}
        onPress={() => onMove({ id, by: 1 })}
      />
    </XStack>
  );
}

/** What the buttons are called where they are switched on and off. */
const BUTTON_LABELS: Readonly<Record<PlayerButton, string>> = {
  audio: 'Audio tracks',
  subtitles: 'Subtitles',
  speed: 'Speed',
  chapters: 'Chapters',
  nextEpisode: 'Next episode, always',
};

const BUTTON_NOTES: Readonly<Partial<Record<PlayerButton, string>>> = {
  speed: 'Hidden on a player whose engine cannot change its rate.',
  chapters: 'Shown only where the source marks them.',
  nextEpisode: 'It appears at the end of an episode whether this is on or not.',
};

/**
 * The controls, which belong to the app rather than to any player: a player is
 * the engine, not the buttons. Arranged once here, and the same on every one.
 */
function PlayerControlsSection() {
  const { data } = useAppSettings();
  const { set, setButton } = useAppSettingActions();
  const settings = data ?? APP_DEFAULTS;
  return (
    <>
      <SettingsSection title="Controls" footer="The same on every player: a player is the engine, and the controls are the app’s. Back, play and forward are always in the middle.">
        <SettingsRow
          title="Skip by"
          subtitle="How far the two buttons either side of play move."
          trailing={
            <XStack gap="$1">
              {SEEK_CHOICES.map((seconds) => (
                <Button
                  key={seconds}
                  size="$2"
                  aria-label={`Skip by ${seconds} seconds`}
                  disabled={set.isPending}
                  {...(settings.seekMs === seconds * 1000 ? ({ theme: 'accent' } as const) : {})}
                  onPress={() => set.mutate({ seekMs: seconds * 1000 })}
                >
                  <Button.Text>{seconds}s</Button.Text>
                </Button>
              ))}
            </XStack>
          }
        />
      </SettingsSection>
      <SettingsSection title="Buttons" footer="What sits in the row beneath the picture, in this order.">
        {PLAYER_BUTTONS.map((button) => (
          <SettingsRow
            key={button}
            title={BUTTON_LABELS[button]}
            {...(BUTTON_NOTES[button] ? { subtitle: BUTTON_NOTES[button] } : {})}
            trailing={
              <AppSwitch
                label={BUTTON_LABELS[button]}
                checked={settings.buttons.includes(button)}
                disabled={setButton.isPending}
                onCheckedChange={(shown) => setButton.mutate({ button, shown })}
              />
            }
          />
        ))}
      </SettingsSection>
    </>
  );
}
