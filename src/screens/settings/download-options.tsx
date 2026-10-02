import { Stack } from 'expo-router';
import { Paragraph } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { Screen } from '@/components/screen';
import { ChoiceRow, SettingsRow, SettingsSection } from '@/components/settings-list';
import { useDownloadActions, useDownloadBudget, useDownloadSettings } from '@/hooks/use-downloads';
import { BITRATE_CHOICES, HEIGHT_CHOICES } from '@/services/downloads/settings';
import type { DownloadSettings } from '@/services/ports';

/**
 * What to ask a source for when keeping a copy. This device's preference about
 * every source at once — a connection belongs to the account — so it sits
 * beside the downloads it is about rather than under any one source.
 *
 * A source that cannot make something smaller simply hands over what it has:
 * these settings then do nothing for it, which is why the footer says so
 * rather than the rows being hidden.
 */
export function DownloadOptionsScreen() {
  const { data: settings } = useDownloadSettings();
  const { data: budget } = useDownloadBudget();
  const { set } = useDownloadActions();

  if (!settings) return <Screen>{null}</Screen>;

  return (
    <Screen gap="$4">
      <Stack.Screen options={{ title: 'Download options' }} />
      {budget?.limitBytes === 0 ? (
        <Paragraph color="$color10">This device keeps no downloads, so there is nothing to choose here.</Paragraph>
      ) : (
        <SettingsSection
          title="Quality"
          footer="What to ask for when you keep a copy. A server that can make a smaller one does; a source that cannot simply hands over the file it has."
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
            label={heightName}
            value={settings.maxHeight}
            disabled={!settings.askForSmaller}
            onChoose={(maxHeight) => set.mutate({ maxHeight })}
          />
          <ChoiceRow
            title="Quality"
            subtitle="Higher looks better and takes more room."
            options={BITRATE_CHOICES}
            label={bitrateName}
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
      )}
    </Screen>
  );
}

const heightName = (height: number) => (height >= 2160 ? '4K' : `${height}p`);
const bitrateName = (bitrate: number) => `${Math.round(bitrate / 1_000_000)} Mbps`;

/** The options in the fewest words: "1080p · 8 Mbps", or the file as it is. */
export function downloadOptionsSummary(settings: DownloadSettings | undefined): string {
  if (!settings) return 'What to ask for';
  if (!settings.askForSmaller) return 'The file as it is';
  return [heightName(settings.maxHeight), bitrateName(settings.maxBitrate), ...(settings.hdr ? ['HDR'] : [])].join(' · ');
}
