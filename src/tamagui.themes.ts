import { createV5Theme, defaultChildrenThemes } from '@tamagui/config/v5';

// The app's own identity (spec §13 — no borrowed brand colours): black, grey
// and white for the page and its words, so nothing tints what is read, and
// the icon's brass for what is pressed and what is chosen. This module holds
// the colours alone, with no React Native import, so a test can check what
// they emit; `tamagui.config.ts` is still the one entry point, and nothing
// else imports this.
//
// A step does one job in both schemes. Tamagui draws the page from step 2
// and every see-through shade of it from step 1, so both are pure black — an
// OLED screen's own — or pure white. Every grey round-trips the whole-percent
// `hsla()` Tamagui emits, so what is written here is what is drawn.

/** Darkest to lightest. */
export const darkGreys = [
  '#000000',
  '#000000',
  // A field, a chip, an unchosen pill.
  '#1c1c1c',
  // A border, a button, a pressed row, a track.
  '#2e2e2e',
  '#3d3d3d',
  '#4d4d4d',
  '#666666',
  // A field's placeholder: 4.6:1 inside it.
  '#858585',
  '#8f8f8f',
  // Muted words: 8.3:1 on the page.
  '#a3a3a3',
  '#c7c7c7',
  '#ffffff',
];

/** Lightest to darkest: the same jobs the other way round. */
export const lightGreys = [
  '#ffffff',
  '#ffffff',
  '#f0f0f0',
  '#d6d6d6',
  '#c7c7c7',
  '#b3b3b3',
  '#999999',
  '#6b6b6b',
  '#616161',
  '#525252',
  '#3b3b3b',
  '#000000',
];

// The icon's brass. The theme fills with accent10 and writes accent3 on it in
// the dark; the top three are the icon's own, and accent8 — under a pressed
// button's label — is lighter than the ramp would make it.
export const brassDark = {
  accent1: '#17120d',
  accent2: '#1e1911',
  accent3: '#32240f',
  accent4: '#422e0b',
  accent5: '#503912',
  accent6: '#60471b',
  accent7: '#725723',
  accent8: '#93712f',
  accent9: '#c08f34',
  accent10: '#d9a441',
  accent11: '#f4cf6a',
  accent12: '#fff1b8',
};

// On white the fill is a deeper bronze, with accent1 written on it (below):
// accent10 holds 5.4:1 against the page as a tab's tint or a focus ring, and
// accent4 is strong enough to say where a remote's focus is.
export const brassLight = {
  accent1: '#fefdfb',
  accent2: '#fcf8ee',
  accent3: '#f8eed3',
  accent4: '#f0daa8',
  accent5: '#e8cc8d',
  accent6: '#dcbb74',
  accent7: '#cda551',
  accent8: '#a9802d',
  accent9: '#956f23',
  accent10: '#87641c',
  accent11: '#715014',
  accent12: '#3e2c0f',
};

const built = createV5Theme({
  darkPalette: darkGreys,
  lightPalette: lightGreys,
  accent: { light: brassLight, dark: brassDark },
  childrenThemes: defaultChildrenThemes,
});

// Tamagui turns the accent's pair round in a light theme — a pale fill with
// the bronze written on it, a cream tint on white nobody can read — in the
// light theme and in each of its colours. There the fill is accent10, as in
// the dark, with the lightest step written on it. The accent's own themes,
// which are the pair turned round on purpose, keep theirs.
const named: Readonly<Record<string, Readonly<Record<string, unknown>>>> = built;
const swapped = { background: built.light.accentBackground, color: built.light.accentColor };
const fill = { accentBackground: built.light.accent10, accentColor: built.light.accent1 };

export const themes = Object.fromEntries(
  Object.entries(named).map(([name, theme]) => [
    name,
    name.startsWith('light') && theme.accentBackground === swapped.background && theme.accentColor === swapped.color ? { ...theme, ...fill } : theme,
  ]),
) as typeof built;
