import { Download } from '@tamagui/lucide-icons-2/icons/Download';
import { Pause } from '@tamagui/lucide-icons-2/icons/Pause';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { Stack } from 'expo-router';
import { Paragraph, SizableText, XStack, YStack } from 'tamagui';

import { px } from '@/components/density';
import { isTV } from '@/components/remote';
import { Button } from '@/components/button';
import { AppSwitch } from '@/components/app-switch';
import { ConfirmButton } from '@/components/confirm-button';
import { fileSize } from '@/components/labels';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useDownloadActions, useDownloadBudget, useDownloads, useDownloadSettings } from '@/hooks/use-downloads';
import { useServices } from '@/hooks/services-context';
import { SIZE_CHOICES } from '@/services/downloads/settings';
import type { DownloadEntry } from '@/services/ports';

/**
 * What this device keeps: the budget, what is in it, and what is still coming
 * down. Device-wide, like players — a copy on this phone is this phone's.
 */
export function DownloadsScreen() {
  const { data: settings } = useDownloadSettings();
  const { data: budget } = useDownloadBudget();
  const { data: entries = [] } = useDownloads();
  const { set, remove, pause, resume } = useDownloadActions();
  const { downloads } = useServices();
  const available = downloads !== undefined && budget !== undefined && budget.limitBytes > 0;

  if (!settings) return <Screen>{null}</Screen>;

  return (
    <Screen gap="$4">
      <Stack.Screen options={{ title: 'Downloads' }} />

      {budget && budget.freeBytes === 0 && budget.limitBytes === 0 ? (
        <Paragraph color="$color10">
          {isTV
            ? 'A TV keeps nothing the system may not clear away, so it has nowhere to keep a film. Downloads work in the app on your phone or tablet.'
            : 'A browser has nowhere to keep a film it could play again later. Downloads work in the app on your phone or tablet.'}
        </Paragraph>
      ) : null}

      <SettingsSection
        title="Space"
        {...(budget
          ? {
              footer: `${fileSize(budget.usedBytes) ?? '0 B'} of ${fileSize(budget.limitBytes) ?? '—'} used · ${fileSize(budget.freeBytes) ?? '—'} free on this device.`,
            }
          : {})}
      >
        <ChoiceRow
          title="Keep at most"
          options={SIZE_CHOICES}
          label={(bytes) => fileSize(bytes) ?? String(bytes)}
          value={settings.maxBytes}
          onChoose={(maxBytes) => set.mutate({ maxBytes })}
        />
        <SettingsRow
          title="Only on Wi-Fi"
          subtitle="A film over mobile data is somebody’s whole month."
          trailing={
            <AppSwitch
              label="Only on Wi-Fi"
              checked={settings.onlyOnWifi}
              onCheckedChange={(onlyOnWifi) => set.mutate({ onlyOnWifi })}
            />
          }
        />
      </SettingsSection>

      {budget?.nearlyFull ? (
        <Paragraph color="$orange11">
          {budget.full
            ? 'There is no room left. Delete something below before downloading more.'
            : 'Nearly full — the next download may not fit.'}
        </Paragraph>
      ) : null}

      {entries.length > 0 ? (
        <SettingsSection title={entries.length === 1 ? '1 download' : `${entries.length} downloads`}>
          {entries.map((entry) => (
            <SettingsRow
              key={entry.id}
              title={entry.item.title}
              subtitle={describe(entry)}
              trailing={
                <XStack gap="$2" items="center">
                  {entry.state === 'running' || entry.state === 'queued' ? (
                    <Button size="$2" icon={Pause} aria-label="Pause" onPress={() => pause.mutate(entry.id)} />
                  ) : entry.state === 'paused' || entry.state === 'failed' ? (
                    <Button size="$2" icon={Play} aria-label="Resume" onPress={() => resume.mutate(entry.id)} />
                  ) : null}
                  <ConfirmButton
                    label="Delete"
                    title={`Delete “${entry.item.title}”?`}
                    description="The file goes from this device. Nothing changes on the server."
                    confirmLabel="Delete"
                    onConfirm={() => remove.mutate(entry.id)}
                  />
                </XStack>
              }
            />
          ))}
        </SettingsSection>
      ) : available ? (
        <YStack gap="$2" items="center" py="$6">
          <Download size={24} color="$color9" />
          <SizableText color="$color10">Nothing kept on this device yet.</SizableText>
          <SizableText size="$2" color="$color9" text="center" maxW={px(420)}>
            Open a film or an episode and choose Download. What you keep plays with no network at all.
          </SizableText>
        </YStack>
      ) : null}
    </Screen>
  );
}

/** Where a download has got to, in the fewest words that are still true. */
function describe(entry: DownloadEntry): string {
  const done = fileSize(entry.bytesDone) ?? '0 B';
  const total = entry.bytesTotal === undefined ? undefined : fileSize(entry.bytesTotal);
  switch (entry.state) {
    case 'done':
      return `Kept · ${done}`;
    case 'running':
      return total ? `${done} of ${total}` : `${done} so far`;
    case 'queued':
      return 'Waiting';
    case 'paused':
      return `Paused · ${done}`;
    case 'failed':
      return entry.errorCode === 'STORAGE_FAILURE' ? 'No room left' : 'Could not finish';
  }
}

function ChoiceRow<T extends number>({
  title,
  subtitle,
  options,
  label,
  value,
  onChoose,
}: {
  title: string;
  subtitle?: string;
  options: readonly T[];
  label: (option: T) => string;
  value: T;
  onChoose: (option: T) => void;
}) {
  return (
    <SettingsRow
      title={title}
      {...(subtitle ? { subtitle } : {})}
      trailing={
        <XStack gap="$1" flexWrap="wrap" justify="flex-end" maxW={px(260)}>
          {options.map((option) => (
            <Button
              key={String(option)}
              size="$2"
              aria-label={`${title}: ${label(option)}`}
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
