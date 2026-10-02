import type { ReactElement } from 'react';

import { Button } from '@/components/button';
import { px } from '@/components/density';
import { PrimaryButton } from '@/components/primary-button';
import { isTV } from '@/components/remote';
import { useAppSettings } from '@/hooks/use-app-settings';
import { APP_DEFAULTS } from '@/services/app-settings';

/**
 * One of a title page's buttons: its symbol alone, or its symbol and its
 * words, as Settings → App says. Its words are its label either way, so a
 * screen reader — and a remote's focus — always says what it does.
 */
export function ActionButton({
  icon,
  label,
  primary = false,
  disabled = false,
  preferred = false,
  onPress,
}: {
  icon: ReactElement;
  label: string;
  /** The one call to action: in the accent, and wider than a symbol on its own. */
  primary?: boolean;
  disabled?: boolean;
  /** On a TV: where the focus starts. */
  preferred?: boolean;
  onPress: () => void;
}) {
  const { data } = useAppSettings();
  const words = (data?.buttonLabels ?? APP_DEFAULTS.buttonLabels) === 'symbolsAndText';
  const Control = primary ? PrimaryButton : Button;
  return (
    <Control
      size="$4"
      icon={icon}
      aria-label={label}
      disabled={disabled}
      // Only a TV knows it: anywhere else Tamagui hands it to the DOM, which does not.
      {...(isTV && preferred ? { hasTVPreferredFocus: true } : {})}
      onPress={onPress}
      {...(words ? {} : primary ? { minW: px(112) } : { circular: true })}
    >
      {words ? label : null}
    </Control>
  );
}
