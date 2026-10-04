import { useState } from 'react';
import { SizableText, Slider, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { px } from '@/components/density';
import { fileSize, listed } from '@/components/labels';
import { isTV } from '@/components/remote';
import { ChoiceRow, SettingsRow } from '@/components/settings-list';
import { useAppSettingActions, useAppSettings } from '@/hooks/use-app-settings';
import { useDownloadBudget } from '@/hooks/use-downloads';
import { usePlayers } from '@/hooks/use-players';
import { APP_DEFAULTS, BUFFER_DISK_MAX, BUFFER_DISK_STEP } from '@/services/app-settings';
import { BUFFERINGS } from '@/services/ports';

const BUFFERING_NAMES = { off: 'Off', memory: 'Memory', disk: 'Disk' } as const;

const BUFFERING_HELP = {
  off: 'As little ahead as playing needs: the quickest start, and the first to stall on a weak network.',
  memory: 'Each player reads ahead in memory, as it does by itself.',
  disk: 'Reads far ahead onto this device’s storage, for a network that comes and goes.',
} as const;

/**
 * Settings → App's Buffering: how far ahead the player reads, and where it
 * keeps it. Disk is offered where a player on this device can keep it there
 * (`buffersOnDisk`), and names the ones that keep it in memory instead.
 */
export function BufferingRows() {
  const { data } = useAppSettings();
  const { set } = useAppSettingActions();
  const { data: players = [] } = usePlayers();
  const budget = useDownloadBudget();
  const settings = data ?? APP_DEFAULTS;
  const busy = data === undefined || set.isPending;
  const playing = players.filter((player) => player.enabled && player.playsHere);
  const onDisk = playing.some((player) => player.buffersOnDisk);
  // Named from their manifests, so no player is named in this file.
  const inMemory = playing.filter((player) => !player.buffersOnDisk).map((player) => player.manifest.displayName);
  const options = BUFFERINGS.filter((mode) => mode !== 'disk' || onDisk);
  const mode = settings.buffering === 'disk' && !onDisk ? 'memory' : settings.buffering;
  // Half of what is free, where the device says: a cache never crowds out the rest.
  const free = budget.data?.freeBytes ?? 0;
  const max = free > 0 ? Math.max(BUFFER_DISK_STEP, Math.min(BUFFER_DISK_MAX, Math.floor(free / 2 / BUFFER_DISK_STEP) * BUFFER_DISK_STEP)) : BUFFER_DISK_MAX;
  const limit = Math.min(max, Math.max(BUFFER_DISK_STEP, settings.bufferDiskBytes));
  const notes = [
    'For what is playing, and gone when it closes.',
    'Never for a live channel, which would only grow, nor for a copy on this device.',
    'In memory instead when storage runs short.',
    ...(inMemory.length > 0 ? [`${listed(inMemory)} ${inMemory.length === 1 ? 'keeps' : 'keep'} it in memory.`] : []),
  ];
  return (
    <>
      <ChoiceRow
        title="Buffering"
        subtitle={BUFFERING_HELP[mode]}
        options={options}
        label={(option) => BUFFERING_NAMES[option]}
        value={mode}
        disabled={busy}
        onChoose={(option) => set.mutate({ buffering: option })}
      />
      {mode === 'disk' ? <DiskLimit notes={notes.join(' ')} value={limit} max={max} disabled={busy} onChange={(bufferDiskBytes) => set.mutate({ bufferDiskBytes })} /> : null}
    </>
  );
}

/**
 * The limit, said once: on a phone beside a slider, following the thumb; on a
 * TV, whose remote cannot drag one, between a step down and a step up.
 */
function DiskLimit({ notes, value, max, disabled, onChange }: { notes: string; value: number; max: number; disabled: boolean; onChange: (bytes: number) => void }) {
  const [dragging, setDragging] = useState<number>();
  if (isTV) {
    const step = (direction: -1 | 1) => onChange(Math.min(max, Math.max(BUFFER_DISK_STEP, value + direction * BUFFER_DISK_STEP)));
    const steps = (
      <XStack gap="$3" items="center">
        <Button size="$3" aria-label="Disk cache limit: less" disabled={disabled || value <= BUFFER_DISK_STEP} onPress={() => step(-1)}>
          <Button.Text>−</Button.Text>
        </Button>
        <SizableText size="$4" minW={px(90)} text="center">
          {fileSize(value)}
        </SizableText>
        <Button size="$3" aria-label="Disk cache limit: more" disabled={disabled || value >= max} onPress={() => step(1)}>
          <Button.Text>+</Button.Text>
        </Button>
      </XStack>
    );
    return <SettingsRow title="Disk cache limit" subtitle={notes} subtitleLines={4} trailing={steps} />;
  }
  return (
    <YStack>
      <SettingsRow title="Disk cache limit" subtitle={notes} subtitleLines={8} trailing={<SizableText size="$4">{fileSize(dragging ?? value)}</SizableText>} />
      <YStack px="$4" pb="$4">
        <Slider
          size="$2"
          min={BUFFER_DISK_STEP}
          max={max}
          step={BUFFER_DISK_STEP}
          value={[dragging ?? value]}
          disabled={disabled}
          onValueChange={(next) => setDragging(next[0])}
          onSlideEnd={(_event, next) => {
            setDragging(undefined);
            onChange(next);
          }}
          aria-label="Disk cache limit"
        >
          <Slider.Track>
            <Slider.TrackActive bg="$accent9" />
          </Slider.Track>
          <Slider.Thumb index={0} circular size="$1" />
        </Slider>
      </YStack>
    </YStack>
  );
}
