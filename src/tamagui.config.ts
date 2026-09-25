import { createV5Theme, defaultChildrenThemes, defaultConfig } from '@tamagui/config/v5';
// CSS transitions on web; its react-native build is the RN Animated driver.
import { animations } from '@tamagui/config/v5-css';
import { createTamagui } from 'tamagui';

// The app's own identity (spec §13 — no borrowed brand colours): a cool,
// blue-grey ink for surfaces, darkest to lightest…
const ink = [
  '#07090a',
  '#0e1214',
  '#13181b',
  '#1a2024',
  '#232b30',
  '#2e373d',
  '#434e55',
  '#5b676e',
  '#76838a',
  '#9aa6ac',
  '#c4ccd0',
  '#f4f7f8',
];

// …and one accent, a teal ramp, used for primary actions and selection.
const tealLight = {
  accent1: '#fafefd',
  accent2: '#f3fbf9',
  accent3: '#e0f8f3',
  accent4: '#ccf3ea',
  accent5: '#b8eae0',
  accent6: '#a1ded2',
  accent7: '#83cdc1',
  accent8: '#53b9ab',
  accent9: '#12a594',
  accent10: '#0d9b8a',
  accent11: '#008573',
  accent12: '#0d3d38',
};

const tealDark = {
  accent1: '#0d1514',
  accent2: '#111c1b',
  accent3: '#0d2d2a',
  accent4: '#023b37',
  accent5: '#084843',
  accent6: '#145750',
  accent7: '#1c6961',
  accent8: '#207e73',
  accent9: '#12a594',
  accent10: '#0eb39e',
  accent11: '#0bd8b6',
  accent12: '#adf0dd',
};

export const config = createTamagui({
  ...defaultConfig,
  themes: createV5Theme({
    darkPalette: ink,
    accent: { light: tealLight, dark: tealDark },
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
