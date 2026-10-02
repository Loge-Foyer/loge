import { createSystemFont, createV5Theme, defaultChildrenThemes, defaultConfig, tokens } from '@tamagui/config/v5';
// CSS transitions on web; its react-native build is the RN Animated driver.
import { animations } from '@tamagui/config/v5-css';
import { Platform } from 'react-native';
import { createTamagui } from 'tamagui';

// The app's own identity (spec §13 — no borrowed brand colours), drawn from
// Loge's icon: a velvet-black for surfaces, red-brown in the dark steps and
// ivory at the light end, darkest to lightest… Each step keeps the lightness
// of the blue-grey it replaced, so every contrast the screens had, they keep.
const velvet = [
  '#0f0606',
  '#1a0d0d',
  '#221212',
  '#2b1a18',
  '#372422',
  '#44302c',
  '#5b4741',
  '#736059',
  '#8d7d75',
  '#ada199',
  '#d3c8bf',
  '#fbf6ee',
];

// …and one accent, the icon's brass, used for primary actions and selection.
// The theme fills with accent10 and writes accent3 on it, so the top three are
// the icon's own brass, and accent8 — under a pressed button's label — is
// lighter than the ramp would make it.
const brassLight = {
  accent1: '#fefdfa',
  accent2: '#fbf9f2',
  accent3: '#f9f2de',
  accent4: '#f4e9c8',
  accent5: '#ecddb4',
  accent6: '#e2ce9d',
  accent7: '#d2ba81',
  accent8: '#c2a055',
  accent9: '#b18828',
  accent10: '#a77f23',
  accent11: '#916b16',
  accent12: '#443112',
};

const brassDark = {
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

// A TV is read from across the room: its type is built about 1.6 times the
// phone's, and its spaces, sizes and corners 1.5 times — so a button, a row or
// a card grows with the words in it, and every screen scales from this one
// place. Breakpoints are left alone: a TV's 1920-point width is still `$xl`.
// `components/density.ts` matches the 1.5 for the few sizes written by hand.
const TV = Platform.isTV === true;
const TYPE = 1.6;
const SPACE = 1.5;

const scaled = <T extends Readonly<Record<string, number>>>(table: T, by: number): T =>
  Object.fromEntries(Object.entries(table).map(([key, value]) => [key, Math.round(value * by)])) as T;

const tvTokens = {
  ...tokens,
  size: scaled(tokens.size, SPACE),
  space: scaled(tokens.space, SPACE),
  radius: scaled(tokens.radius, SPACE),
};

const tvFonts = {
  body: createSystemFont({ sizeSize: (size) => Math.round(size * TYPE) }),
  heading: createSystemFont({
    font: { weight: { 0: '600', 6: '700', 9: '800' } },
    sizeSize: (size) => Math.round(size * TYPE),
    sizeLineHeight: (size) => Math.round(size * 1.2),
  }),
};

export const config = createTamagui({
  ...defaultConfig,
  ...(TV ? { tokens: tvTokens, fonts: tvFonts } : {}),
  themes: createV5Theme({
    darkPalette: velvet,
    accent: { light: brassLight, dark: brassDark },
    childrenThemes: defaultChildrenThemes,
  }),
  animations,
});

export type AppConfig = typeof config;

declare module 'tamagui' {
  // Augmenting a module takes an interface; the empty body is the point.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends AppConfig {}
}
