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
import { useDownloadActions, useDownloadBudget, useDownloadSettings } from '@/hooks/use-downloads';
import { usePlayerActions, usePlayers } from '@/hooks/use-players';
import { APP_DEFAULTS, HOLD_RATES, SEEK_CHOICES, type ButtonRow } from '@/services/app-settings';
import { BITRATE_CHOICES, HEIGHT_CHOICES } from '@/services/downloads/settings';
import { PLAYER_BUTTONS, PLAYER_JUMPS, PLAYER_SLIDERS, type PlayerButton, type PlayerJump, type PlayerSlider } from '@/services/ports';
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
        <Stack.Screen options={{ title: 'Adapters' }} />
        <SizableText color="$color10">There is no such list of adapters.</SizableText>
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
      {category === 'sources' ? <DownloadQualitySection /> : null}
      {category === 'sync' ? <BackupSection /> : null}
    </Screen>
  );
}

/**
 * What to ask a source for when keeping a copy. It sits under the sources
 * rather than inside any one connection: it is this device's preference about
 * every source at once, and a connection belongs to the account.
 *
 * A source that cannot make something smaller simply hands over what it has —
 * these settings then do nothing for it, which is why the footer says so
 * rather than the rows being hidden.
 */
function DownloadQualitySection() {
  const { data: settings } = useDownloadSettings();
  const { data: budget } = useDownloadBudget();
  const { set } = useDownloadActions();
  // A browser has nowhere to keep a film, so there is nothing to set up.
  if (!settings || budget?.limitBytes === 0) return null;
  return (
    <SettingsSection
      title="Downloads"
      footer="What to ask for when you keep a copy. Jellyfin, Emby and Plex can make a smaller one; a source that cannot simply hands over the file it has. How much room downloads may take is in Settings → Downloads."
    >
      <SettingsRow
        title="Ask for a smaller copy"
        subtitle="An 80 GB film becomes a few GB. The server does the work."
        trailing={
          <AppSwitch
            label="Ask for a smaller copy"
            checked={settings.askForSmaller}
            onCheckedChange={(askForSmaller) => set.mutate({ askForSmaller })}
          />
        }
      />
      <ChoiceRow
        title="Resolution"
        options={HEIGHT_CHOICES}
        label={(height) => (height >= 2160 ? '4K' : `${height}p`)}
        value={settings.maxHeight}
        disabled={!settings.askForSmaller}
        onChoose={(maxHeight) => set.mutate({ maxHeight })}
      />
      <ChoiceRow
        title="Quality"
        subtitle="Higher looks better and takes more room."
        options={BITRATE_CHOICES}
        label={(bitrate) => `${Math.round(bitrate / 1_000_000)} Mbps`}
        value={settings.maxBitrate}
        disabled={!settings.askForSmaller}
        onChoose={(maxBitrate) => set.mutate({ maxBitrate })}
      />
      <SettingsRow
        title="Keep HDR"
        subtitle="Only where the source has it. Most phones show an SDR copy more faithfully."
        disabled={!settings.askForSmaller}
        trailing={
          <AppSwitch
            label="Keep HDR"
            checked={settings.hdr}
            disabled={!settings.askForSmaller}
            onCheckedChange={(hdr) => set.mutate({ hdr })}
          />
        }
      />
    </SettingsSection>
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

const JUMP_LABELS: Readonly<Record<PlayerJump, string>> = { off: 'Off', seek: 'Seconds', chapter: 'Chapter' };
const SLIDER_LABELS: Readonly<Record<PlayerSlider, string>> = { off: 'Off', brightness: 'Brightness', volume: 'Volume' };

/** A row whose trailing edge is a short list of choices, one of them taken. */
function ChoiceRow<T extends string | number>({
  title,
  subtitle,
  options,
  label,
  value,
  disabled,
  onChoose,
}: {
  title: string;
  subtitle?: string;
  options: readonly T[];
  label: (option: T) => string;
  value: T;
  disabled: boolean;
  onChoose: (option: T) => void;
}) {
  return (
    <SettingsRow
      title={title}
      {...(subtitle ? { subtitle } : {})}
      trailing={
        <XStack gap="$1" flexWrap="wrap" justify="flex-end" maxW={240}>
          {options.map((option) => (
            <Button
              key={String(option)}
              size="$2"
              aria-label={`${title}: ${label(option)}`}
              disabled={disabled}
              {...(option === value ? ({ theme: 'accent' } as const) : {})}
              onPress={() => onChoose(option)}
            >
              <Button.Text>{label(option)}</Button.Text>
            </Button>
          ))}
        </XStack>
      }
    />
  );
}

function ButtonRows({ row, title, footer }: { row: ButtonRow; title: string; footer: string }) {
  const { data } = useAppSettings();
  const { setButton } = useAppSettingActions();
  const settings = data ?? APP_DEFAULTS;
  return (
    <SettingsSection title={title} footer={footer}>
      {PLAYER_BUTTONS.map((button) => (
        <SettingsRow
          key={button}
          title={BUTTON_LABELS[button]}
          {...(BUTTON_NOTES[button] ? { subtitle: BUTTON_NOTES[button] } : {})}
          trailing={
            <AppSwitch
              label={`${BUTTON_LABELS[button]} — ${title}`}
              checked={settings[row].includes(button)}
              disabled={setButton.isPending}
              onCheckedChange={(shown) => setButton.mutate({ row, button, shown })}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}

/**
 * The controls, which belong to the app rather than to any player: a player is
 * the engine, not the buttons. Arranged once here, and the same on every one.
 */
function PlayerControlsSection() {
  const { data } = useAppSettings();
  const { set } = useAppSettingActions();
  const { data: players = [] } = usePlayers();
  const settings = data ?? APP_DEFAULTS;
  const busy = set.isPending;
  // Named from their manifests, so no player is named in this file.
  const cannotShrink = players.filter((player) => player.playsHere && !player.canShrink).map((player) => player.manifest.displayName);
  return (
    <>
      <SettingsSection title="Controls" footer="The same on every player: a player is the engine, and the controls are the app’s. Play itself is always in the middle.">
        <ChoiceRow
          title="Skip by"
          subtitle="How far a seek moves, by button or by tap."
          options={SEEK_CHOICES}
          label={(seconds) => `${seconds}s`}
          value={(SEEK_CHOICES.find((seconds) => seconds * 1000 === settings.seekMs) ?? 10) as (typeof SEEK_CHOICES)[number]}
          disabled={busy}
          onChoose={(seconds) => set.mutate({ seekMs: seconds * 1000 })}
        />
        <ChoiceRow
          title="Either side of play"
          options={PLAYER_JUMPS}
          label={(jump) => JUMP_LABELS[jump]}
          value={settings.centreJump}
          disabled={busy}
          onChoose={(centreJump) => set.mutate({ centreJump })}
        />
        <ChoiceRow
          title="Double tap a side"
          subtitle="Left goes back, right goes forward."
          options={PLAYER_JUMPS}
          label={(jump) => JUMP_LABELS[jump]}
          value={settings.doubleTap}
          disabled={busy}
          onChoose={(doubleTap) => set.mutate({ doubleTap })}
        />
        <ChoiceRow
          title="Press and hold"
          subtitle="How fast it plays while a finger is down."
          options={HOLD_RATES}
          label={(rate) => (rate === 1 ? 'Off' : `${rate}×`)}
          value={(HOLD_RATES.find((rate) => rate === settings.holdRate) ?? 1) as (typeof HOLD_RATES)[number]}
          disabled={busy}
          onChoose={(holdRate) => set.mutate({ holdRate })}
        />
        <ChoiceRow
          title="Time at the right"
          options={['left', 'total'] as const}
          label={(which) => (which === 'left' ? 'Left' : 'Total')}
          value={settings.showRemaining ? 'left' : 'total'}
          disabled={busy}
          onChoose={(which) => set.mutate({ showRemaining: which === 'left' })}
        />
      </SettingsSection>

      <SettingsSection title="Edges" footer="Drag down an edge of the picture. Brightness is this app’s window only, and goes back to the system’s when the player closes.">
        <ChoiceRow
          title="Left edge"
          options={PLAYER_SLIDERS}
          label={(slider) => SLIDER_LABELS[slider]}
          value={settings.leftSlider}
          disabled={busy}
          onChoose={(leftSlider) => set.mutate({ leftSlider })}
        />
        <ChoiceRow
          title="Right edge"
          options={PLAYER_SLIDERS}
          label={(slider) => SLIDER_LABELS[slider]}
          value={settings.rightSlider}
          disabled={busy}
          onChoose={(rightSlider) => set.mutate({ rightSlider })}
        />
      </SettingsSection>

      <ButtonRows row="buttons" title="Buttons, beneath" footer="What sits in the row under the picture, in this order." />
      <ButtonRows row="topButtons" title="Buttons, floating" footer="What floats at the top right. The top left is always the title." />

      <SettingsSection title="Decoding" footer="Only an engine that can tell the difference honours this — mpv can; the built-in player leaves it to the system.">
        <SettingsRow
          title="Fall back to software"
          subtitle={
            settings.softwareFallback
              ? 'A stream the hardware decoder refuses is decoded in software: slower, hotter, and quiet about it.'
              : 'A stream the hardware decoder refuses is refused, rather than flattening the battery for it.'
          }
          trailing={
            <AppSwitch
              label="Fall back to software"
              checked={settings.softwareFallback}
              disabled={busy}
              onCheckedChange={(softwareFallback) => set.mutate({ softwareFallback })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Leaving the player" footer="Both are asked of the engine. A player whose engine has neither simply carries on as before — the built-in player has both.">
        <SettingsRow
          title="Picture in picture"
          subtitle={
            cannotShrink.length > 0
              ? `Shrink to a floating window when the app goes behind something else. ${listed(cannotShrink)} cannot on this device: ${cannotShrink.length === 1 ? 'its picture never reaches a layer the system can take over' : 'their pictures never reach a layer the system can take over'}.`
              : 'Shrink to a floating window when the app goes behind something else.'
          }
          trailing={
            <AppSwitch
              label="Picture in picture"
              checked={settings.pictureInPicture}
              disabled={busy}
              onCheckedChange={(pictureInPicture) => set.mutate({ pictureInPicture })}
            />
          }
        />
        <SettingsRow
          title="Keep playing in the background"
          subtitle="Carry on with the sound when the app is not in front."
          trailing={
            <AppSwitch
              label="Keep playing in the background"
              checked={settings.backgroundPlayback}
              disabled={busy}
              onCheckedChange={(backgroundPlayback) => set.mutate({ backgroundPlayback })}
            />
          }
        />
      </SettingsSection>
    </>
  );
}

/** "mpv", or "mpv and the built-in player". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
