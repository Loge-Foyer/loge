import { createSystemFont, defaultConfig, tokens } from '@tamagui/config/v5';
// CSS transitions on web; its react-native build is the RN Animated driver.
import { animations } from '@tamagui/config/v5-css';
import { Platform } from 'react-native';
import { createTamagui } from 'tamagui';

// Black, grey and white, light and dark, and the icon's brass: the colours
// are `tamagui.themes.ts`, which a test reads apart from React Native.
import { themes } from './tamagui.themes';

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
  themes,
  animations,
});

export type AppConfig = typeof config;

declare module 'tamagui' {
  // Augmenting a module takes an interface; the empty body is the point.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends AppConfig {}
}
