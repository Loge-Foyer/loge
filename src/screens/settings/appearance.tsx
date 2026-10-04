import { Screen } from '@/components/screen';
import { ChoiceRow, SettingsSection } from '@/components/settings-list';
import { useAppSettingActions, useAppSettings } from '@/hooks/use-app-settings';
import { APP_DEFAULTS } from '@/services/app-settings';
import { APPEARANCES, BUTTON_LABELS, type AppearanceSetting, type ButtonLabels } from '@/services/ports';

export const APPEARANCE_NAMES: Readonly<Record<AppearanceSetting, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export const BUTTON_LABEL_NAMES: Readonly<Record<ButtonLabels, string>> = {
  symbols: 'Symbols',
  symbolsAndText: 'Symbols and text',
};

/** Light or dark, or as this device is set. */
export function AppearanceRow() {
  const appSettings = useAppSettings();
  const { set } = useAppSettingActions();
  return (
    <ChoiceRow
      title="Appearance"
      subtitle="Light or dark, or as this device is set"
      options={APPEARANCES}
      label={(option) => APPEARANCE_NAMES[option]}
      value={appSettings.data?.appearance ?? APP_DEFAULTS.appearance}
      disabled={appSettings.data === undefined || set.isPending}
      onChoose={(option) => set.mutate({ appearance: option })}
    />
  );
}

/** A title's buttons as symbols, or with their words. */
export function ButtonsRow() {
  const appSettings = useAppSettings();
  const { set } = useAppSettingActions();
  return (
    <ChoiceRow
      title="Buttons"
      subtitle="On a title's page: Play, watched and the rest"
      options={BUTTON_LABELS}
      label={(option) => BUTTON_LABEL_NAMES[option]}
      value={appSettings.data?.buttonLabels ?? APP_DEFAULTS.buttonLabels}
      disabled={appSettings.data === undefined || set.isPending}
      onChoose={(option) => set.mutate({ buttonLabels: option })}
    />
  );
}

/**
 * Settings → App → Appearance: how this device looks, on a page of its own
 * on a TV, where Settings → App is read across a room and was too long. A
 * phone keeps these rows in App itself.
 */
export function AppearanceScreen() {
  return (
    <Screen>
      <SettingsSection title="Appearance" footer="How this device looks. Each device chooses for itself.">
        <AppearanceRow />
        <ButtonsRow />
      </SettingsSection>
    </Screen>
  );
}
