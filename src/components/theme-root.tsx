import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { TamaguiProvider, useTheme } from 'tamagui';

import { useStartedAppSettings } from '@/hooks/use-app-settings';
import { config } from '@/tamagui.config';

type Scheme = 'light' | 'dark';

/**
 * The one theme entry point: Tamagui, plus the navigation theme derived from
 * it — light or dark as this device's Appearance says, or as the device
 * itself is set. Dark until either is known.
 */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const { settings } = useStartedAppSettings();
  const choice = settings?.appearance;
  const system = useColorScheme();
  const scheme: Scheme = choice === 'light' || choice === 'dark' ? choice : system === 'light' ? 'light' : 'dark';

  // What is drawn natively — the tab bar, sheets, alerts, the keyboard —
  // follows the app's choice too, not the device's. Before the first paint,
  // so nothing native shows the other scheme. A browser has nothing to set.
  useLayoutEffect(() => {
    if (choice === undefined || process.env.EXPO_OS === 'web') return;
    Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
  }, [choice]);

  return (
    <TamaguiProvider config={config} defaultTheme={scheme}>
      <NavigationTheme scheme={scheme}>{children}</NavigationTheme>
    </TamaguiProvider>
  );
}

function NavigationTheme({ scheme, children }: { scheme: Scheme; children: ReactNode }) {
  const theme = useTheme();
  // Native headers and tab bars take plain colours, not theme variables.
  const background = String(theme.background.val);
  const text = String(theme.color.val);
  const border = String(theme.borderColor.val);
  const accent = String(theme.accentBackground.val);

  // The window behind every screen, which shows while one turns or fades.
  useLayoutEffect(() => {
    void SystemUI.setBackgroundColorAsync(background).catch(() => undefined);
  }, [background]);

  const value = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: accent,
        background,
        card: background,
        text,
        border,
        notification: accent,
      },
    };
  }, [accent, background, border, scheme, text]);

  return (
    <ThemeProvider value={value}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeProvider>
  );
}
