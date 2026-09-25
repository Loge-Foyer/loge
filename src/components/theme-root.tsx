import { DarkTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode } from 'react';
import { TamaguiProvider, useTheme } from 'tamagui';

import { config } from '@/tamagui.config';

/** The one theme entry point: Tamagui, plus the navigation theme derived from it. */
export function ThemeRoot({ children }: { children: ReactNode }) {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <NavigationTheme>{children}</NavigationTheme>
    </TamaguiProvider>
  );
}

function NavigationTheme({ children }: { children: ReactNode }) {
  const theme = useTheme();
  // Native headers and tab bars take plain colours, not theme variables.
  const background = String(theme.background.val);
  const text = String(theme.color.val);
  const border = String(theme.borderColor.val);
  const accent = String(theme.accentBackground.val);

  const value = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: accent,
        background,
        card: background,
        text,
        border,
        notification: accent,
      },
    }),
    [accent, background, border, text],
  );

  return (
    <ThemeProvider value={value}>
      <StatusBar style="light" />
      {children}
    </ThemeProvider>
  );
}
