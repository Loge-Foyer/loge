import type { AudioTrack, ConnectionId, Episode, GlobalMediaKey, MediaItem, MediaPlayer, PluginId, SubtitleTrack } from '@sc/api';
import type { PlayerView } from '@sc/player-kit';
import { AudioLines } from '@tamagui/lucide-icons-2/icons/AudioLines';
import { Captions } from '@tamagui/lucide-icons-2/icons/Captions';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { ChevronUp } from '@tamagui/lucide-icons-2/icons/ChevronUp';
import { Pause } from '@tamagui/lucide-icons-2/icons/Pause';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { RotateCw } from '@tamagui/lucide-icons-2/icons/RotateCw';
import { SkipForward } from '@tamagui/lucide-icons-2/icons/SkipForward';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Button, SizableText, Slider, Spinner, XStack, YStack } from 'tamagui';

import { clockTime, describeMissing, episodeCode } from '@/components/labels';
import { PrimaryButton } from '@/components/primary-button';
import { nowAndNext, useChannels, useGuide, useNow } from '@/hooks/use-live';
import { useItem } from '@/hooks/use-media';
import { useNextEpisode, usePlaybackPlan, usePlaybackReports, usePlayer, usePlayerOrientation, type PlayerSnapshot } from '@/hooks/use-playback';
import { useServices } from '@/hooks/services-context';

const HIDE_AFTER_MS = 3_500;
const SKIP_MS = 10_000;

/**
 * Full screen, over the tabs: the chosen player's own view underneath, the
 * app's controls on top — the same for every engine. Where no player here
 * can play the item, it says which kind would.
 */
export function PlayerScreen({
  connectionId,
  itemId,
  startMs,
  live,
  player,
}: {
  connectionId: ConnectionId;
  itemId: string;
  startMs?: number;
  /** A channel: no item to read, nothing to report, and the channels of its group either side. */
  live?: { readonly title: string; readonly group?: string };
  /** "Play with…": the player the user picked, for this item and the episodes after it. */
  player?: PluginId;
}) {
  usePlayerOrientation();
  const key = { connectionId, externalId: itemId };
  const detail = useItem(key, !live);
  const item = live ? undefined : detail.data?.detail.item;
  const { plan, error: planError, retry } = usePlaybackPlan(live ? key : item?.key, {
    ...(startMs === undefined ? {} : { startMs }),
    ...(live ? { live: true } : {}),
    ...(player ? { player } : {}),
  });
  const report = usePlaybackReports(item, live !== undefined, startMs);
  const { controller, snapshot } = usePlayer(plan, connectionId, report);
  const { playback } = useServices();
  const View = plan?.kind === 'play' ? playback.view(plan.player) : undefined;
  const next = useNextEpisode(item?.type === 'episode' ? item : undefined);

  const problem = !live && detail.error
    ? detail.error.message
    : planError
      ? `This could not be started: ${planError.message}`
      : plan?.kind === 'none'
        ? describeMissing(plan.needs, plan.source)
        : plan?.kind === 'no-player'
          ? 'Every player is switched off on this device.'
          : snapshot.state === 'failed'
            ? (snapshot.error?.message ?? 'This stopped playing.')
            : undefined;

  return (
    <YStack flex={1} bg="black">
      <StatusBar hidden />
      {View && controller ? <Surface view={View} controller={controller} /> : null}
      {problem ? (
        <Notice
          message={problem}
          {...(plan?.kind === 'none' || plan?.kind === 'no-player' ? { players: true } : { onRetry: retry })}
        />
      ) : (
        <Controls
          item={item}
          controller={controller}
          snapshot={snapshot}
          starting={!plan || !controller}
          {...(next.data ? { next: next.data } : {})}
          {...(player ? { player } : {})}
          {...(live ? { live: <LiveBar channel={key} title={live.title} {...(live.group ? { group: live.group } : {})} /> } : {})}
        />
      )}
    </YStack>
  );
}

/** The chosen player's own view, which draws its engine's pictures. */
function Surface({ view: View, controller }: { view: PlayerView; controller: MediaPlayer }) {
  return <View player={controller} style={StyleSheet.absoluteFill} fit="contain" />;
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function Controls({
  item,
  controller,
  snapshot,
  starting,
  next,
  player,
  live,
}: {
  item: MediaItem | undefined;
  controller: MediaPlayer | undefined;
  snapshot: PlayerSnapshot;
  starting: boolean;
  next?: Episode;
  /** The player the user picked, which the next episode keeps. */
  player?: PluginId;
  /** For a channel: its name, now and next, and the channels either side. */
  live?: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  const [touchedAt, setTouchedAt] = useState(0);
  const [panel, setPanel] = useState<'audio' | 'subtitles'>();
  const [scrub, setScrub] = useState<number>();
  const { state, positionMs, durationMs } = snapshot;
  const playing = state === 'playing';
  const waiting = starting || state === 'loading' || state === 'buffering';
  // Out of the way while it plays; back at a touch, and whenever it stops.
  const shown = visible || !playing;

  useEffect(() => {
    if (!shown || !playing || panel || scrub !== undefined) return;
    const timer = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [shown, playing, panel, scrub, touchedAt]);

  const touch = () => {
    setVisible(true);
    setTouchedAt(Date.now());
  };
  const toggle = () => {
    touch();
    if (playing) controller?.pause();
    else controller?.play();
  };
  const skip = (by: number) => {
    touch();
    controller?.seek(Math.max(0, Math.min(durationMs ?? Number.MAX_SAFE_INTEGER, positionMs + by)));
  };
  const playNext = () => {
    if (!next) return;
    router.replace({
      pathname: '/play/[connectionId]/[itemId]',
      params: { connectionId: next.key.connectionId, itemId: next.key.externalId, ...(player ? { player } : {}) },
    });
  };

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={() => (shown ? setVisible(false) : touch())}
      accessibilityLabel={shown ? 'Hide the controls' : 'Show the controls'}
    >
      {shown ? (
        <YStack flex={1} justify="space-between" bg="rgba(0, 0, 0, 0.45)" px="$4" pt="$5" pb="$5">
          <XStack items="center" gap="$3">
            <IconButton label="Close the player" onPress={close}>
              <X size={26} color="white" />
            </IconButton>
            <YStack flex={1}>
              {live}
              {item?.type === 'episode' ? (
                <SizableText size="$2" color="rgba(255,255,255,0.75)" numberOfLines={1}>
                  {[item.showTitle, episodeCode(item)].filter(Boolean).join(' · ')}
                </SizableText>
              ) : null}
              <SizableText size="$5" fontWeight="600" color="white" numberOfLines={1}>
                {item?.title ?? ''}
              </SizableText>
            </YStack>
          </XStack>

          <XStack items="center" justify="center" gap="$8">
            {live ? null : (
              <IconButton label="Back ten seconds" onPress={() => skip(-SKIP_MS)} disabled={!controller}>
                <RotateCcw size={30} color="white" />
              </IconButton>
            )}
            {waiting ? (
              <Spinner size="large" color="white" />
            ) : (
              <IconButton label={playing ? 'Pause' : 'Play'} onPress={toggle} big>
                {playing ? <Pause size={44} color="white" fill="white" /> : <Play size={44} color="white" fill="white" />}
              </IconButton>
            )}
            {live ? null : (
              <IconButton label="Forward ten seconds" onPress={() => skip(SKIP_MS)} disabled={!controller}>
                <RotateCw size={30} color="white" />
              </IconButton>
            )}
          </XStack>

          <YStack gap="$3">
            {panel ? (
              <TrackPanel
                kind={panel}
                tracks={panel === 'audio' ? snapshot.audio : snapshot.subtitles}
                onChoose={(id) => {
                  if (panel === 'audio' && id !== null) controller?.setAudioTrack(id);
                  if (panel === 'subtitles') controller?.setSubtitleTrack(id);
                  setPanel(undefined);
                  touch();
                }}
              />
            ) : null}
            {/* A channel is never scrubbed, even when its stream reports a length. */}
            {durationMs && !live ? (
              <XStack items="center" gap="$3">
                <SizableText size="$2" color="white" minW={52}>
                  {clockTime(scrub ?? positionMs)}
                </SizableText>
                <Slider
                  flex={1}
                  size="$2"
                  max={durationMs}
                  step={1_000}
                  value={[Math.min(durationMs, scrub ?? positionMs)]}
                  onValueChange={(value) => setScrub(value[0])}
                  onSlideEnd={(_event, value) => {
                    controller?.seek(value);
                    setScrub(undefined);
                    touch();
                  }}
                  aria-label="Position"
                >
                  <Slider.Track bg="rgba(255,255,255,0.3)">
                    <Slider.TrackActive bg="$accent9" />
                  </Slider.Track>
                  <Slider.Thumb index={0} circular size="$1" bg="white" />
                </Slider>
                <SizableText size="$2" color="white" minW={52} text="right">
                  {clockTime(durationMs)}
                </SizableText>
              </XStack>
            ) : null}
            <XStack justify="flex-end" gap="$2">
              {snapshot.audio.length > 1 ? (
                <IconButton label="Audio" onPress={() => setPanel(panel === 'audio' ? undefined : 'audio')}>
                  <AudioLines size={24} color="white" />
                </IconButton>
              ) : null}
              {snapshot.subtitles.length > 0 ? (
                <IconButton label="Subtitles" onPress={() => setPanel(panel === 'subtitles' ? undefined : 'subtitles')}>
                  <Captions size={24} color="white" />
                </IconButton>
              ) : null}
              {next ? (
                <Button size="$3" chromeless onPress={playNext} icon={<SkipForward size={20} color="white" />} aria-label="Next episode">
                  <Button.Text color="white">Next episode</Button.Text>
                </Button>
              ) : null}
            </XStack>
          </YStack>
        </YStack>
      ) : null}
    </Pressable>
  );
}

/** A channel's name marked live, what is on now and next, and the channels either side in its group. */
function LiveBar({ channel, title, group }: { channel: GlobalMediaKey; title: string; group?: string }) {
  const channels = useChannels(channel.connectionId, group);
  const list = channels.data?.pages.flatMap((page) => page.value.channels) ?? [];
  const at = list.findIndex((each) => each.key.externalId === channel.externalId);
  const guide = useGuide(channel.connectionId, [channel]);
  const now = useNow();
  const { now: airing, next } = nowAndNext(guide.data?.value, channel, now);
  const zap = (offset: number) => {
    const target = at >= 0 ? list[(at + offset + list.length) % list.length] : undefined;
    if (!target || target.key.externalId === channel.externalId) return;
    router.replace({
      pathname: '/play/[connectionId]/[itemId]',
      params: { connectionId: target.key.connectionId, itemId: target.key.externalId, live: '1', title: target.name, ...(group ? { group } : {}) },
    });
  };
  return (
    <XStack items="center" gap="$3">
      <YStack flex={1} gap="$1">
        <XStack items="center" gap="$2">
          <SizableText size="$1" fontWeight="800" color="white" bg="$red10" px="$1.5" rounded="$2">
            LIVE
          </SizableText>
          <SizableText size="$5" fontWeight="600" color="white" numberOfLines={1}>
            {title}
          </SizableText>
        </XStack>
        {airing ? (
          <SizableText size="$2" color="rgba(255,255,255,0.8)" numberOfLines={1}>
            {`Now: ${airing.title}`}
          </SizableText>
        ) : null}
        {next ? (
          <SizableText size="$2" color="rgba(255,255,255,0.6)" numberOfLines={1}>
            {`Next: ${next.title}`}
          </SizableText>
        ) : null}
      </YStack>
      {list.length > 1 && at >= 0 ? (
        <XStack gap="$2">
          <IconButton label="Previous channel" onPress={() => zap(-1)}>
            <ChevronUp size={28} color="white" />
          </IconButton>
          <IconButton label="Next channel" onPress={() => zap(1)}>
            <ChevronDown size={28} color="white" />
          </IconButton>
        </XStack>
      ) : null}
    </XStack>
  );
}

function TrackPanel({
  kind,
  tracks,
  onChoose,
}: {
  kind: 'audio' | 'subtitles';
  tracks: readonly (AudioTrack | SubtitleTrack)[];
  onChoose: (id: string | null) => void;
}) {
  return (
    <YStack self="flex-end" bg="rgba(20, 20, 20, 0.92)" rounded="$4" p="$2" minW={220} maxW={360}>
      {kind === 'subtitles' ? <TrackRow label="Off" onPress={() => onChoose(null)} /> : null}
      {tracks.map((track) => (
        <TrackRow key={track.id} label={track.label} onPress={() => onChoose(track.id)} />
      ))}
    </YStack>
  );
}

function TrackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <SizableText size="$4" color="white" px="$3" py="$2" numberOfLines={1}>
        {label}
      </SizableText>
    </Pressable>
  );
}

function IconButton({
  label,
  onPress,
  disabled,
  big,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={{ opacity: disabled ? 0.4 : 1, padding: big ? 12 : 6 }}
    >
      {children}
    </Pressable>
  );
}

function Notice({ message, onRetry, players }: { message: string; onRetry?: () => void; players?: boolean }) {
  return (
    <YStack flex={1} items="center" justify="center" gap="$4" px="$6">
      <XStack position="absolute" t="$5" l="$4">
        <IconButton label="Close the player" onPress={close}>
          <X size={26} color="white" />
        </IconButton>
      </XStack>
      <SizableText size="$5" color="white" text="center" maxW={520}>
        {message}
      </SizableText>
      {onRetry ? <PrimaryButton onPress={onRetry}>Try again</PrimaryButton> : null}
      {players ? (
        <PrimaryButton onPress={() => router.push({ pathname: '/settings/plugins/[category]', params: { category: 'players' } })}>
          Players on this device
        </PrimaryButton>
      ) : null}
    </YStack>
  );
}
