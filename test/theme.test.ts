import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_DEFAULTS, appDefaults } from '@/services/app-settings';
import { darkGreys, lightGreys, themes } from '@/tamagui.themes';

// What a screen is drawn with is what Tamagui emits — whole-percent hsla(),
// not the hex written in the palette — so every pair is checked on that.
type Rgba = readonly [number, number, number, number];

function parse(color: string): Rgba {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) return [Number.parseInt(hex[1] ?? '0', 16), Number.parseInt(hex[2] ?? '0', 16), Number.parseInt(hex[3] ?? '0', 16), 1];
  const hsla = /^hsla?\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%(?:,\s*([\d.]+))?\s*\)$/.exec(color);
  if (hsla) {
    const h = Number(hsla[1]) / 360;
    const s = Number(hsla[2]) / 100;
    const l = Number(hsla[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t: number) => {
      const k = (t + 1) % 1;
      const value = k < 1 / 6 ? p + (q - p) * 6 * k : k < 1 / 2 ? q : k < 2 / 3 ? p + (q - p) * (2 / 3 - k) * 6 : p;
      return Math.round(value * 255);
    };
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3), hsla[4] === undefined ? 1 : Number(hsla[4])];
  }
  throw new Error(`Not a colour this test reads: ${color}`);
}

function luminance([r, g, b]: Rgba): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(parse(foreground)), luminance(parse(background))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const named: Readonly<Record<string, Readonly<Record<string, unknown>>>> = themes;

function value(theme: string, key: string): string {
  const found = named[theme]?.[key];
  if (typeof found !== 'string') throw new Error(`${theme} has no ${key}`);
  return found;
}

describe.each(['dark', 'light'] as const)('the %s theme', (scheme) => {
  const page = value(scheme, 'background');
  const pairs: readonly (readonly [string, string, string, number])[] = [
    ['text', value(scheme, 'color'), page, 7],
    ['muted words', value(scheme, 'color10'), page, 7],
    ['secondary words', value(scheme, 'color11'), page, 7],
    // The app's fields write their placeholder in step 8, on the field's own background.
    ['a placeholder in its field', value(scheme, 'color8'), value(`${scheme}_Input`, 'background'), 4.5],
    ['a border', value(scheme, 'borderColor'), page, 1.3],
    ['a primary button’s label', value(scheme, 'accentColor'), value(scheme, 'accentBackground'), 4.5],
    ['the accent on the page — a tab’s tint, a focus ring', value(scheme, 'accent10'), page, 4.5],
    ['a link', value(scheme, 'accent11'), page, 4.5],
    ['a spinner', value(scheme, 'accent9'), page, 3],
    ['a focused row’s title', value(scheme, 'color12'), value(scheme, 'accent4'), 7],
    ['a focused row’s line beneath', value(scheme, 'color10'), value(scheme, 'accent4'), 4.5],
    ['a focused menu item', value(scheme, 'accent11'), value(scheme, 'accent4'), 4.5],
    ['an error', value(scheme, 'red11'), page, 4.5],
    ['a success', value(scheme, 'green11'), page, 4.5],
    ['a warning', value(scheme, 'orange11'), page, 4.5],
  ];

  it.each(pairs)('keeps %s readable', (_name, foreground, background, floor) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(floor);
  });

  it('draws the page pure black or pure white', () => {
    expect(page).toBe(scheme === 'dark' ? 'hsla(0, 0%, 0%, 1)' : 'hsla(0, 0%, 100%, 1)');
    expect(value(scheme, 'color')).toBe(scheme === 'dark' ? 'hsla(0, 0%, 100%, 1)' : 'hsla(0, 0%, 0%, 1)');
  });

  it('fills with accent10 — the light theme’s pair turned round again — in every colour of it', () => {
    expect(value(scheme, 'accentBackground')).toBe(value(scheme, 'accent10'));
    for (const hue of ['red', 'green', 'blue', 'gray']) {
      expect(value(`${scheme}_${hue}`, 'accentBackground')).toBe(value(scheme, 'accent10'));
      expect(value(`${scheme}_${hue}`, 'accentColor')).toBe(value(scheme, 'accentColor'));
    }
  });
});

describe('the palettes', () => {
  it('are greys alone: no tint on what is read', () => {
    for (const grey of [...darkGreys, ...lightGreys]) expect(grey).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
});

describe('the app’s appearance', () => {
  it('follows the device by default, on a phone and on a TV', () => {
    expect(APP_DEFAULTS.appearance).toBe('system');
    expect(appDefaults({ tv: true }).appearance).toBe('system');
  });

  it('lets the native app be light or dark, on a black root view, with the splash left as it is', () => {
    const { expo } = JSON.parse(readFileSync(join(process.cwd(), 'app.json'), 'utf8')) as {
      expo: { userInterfaceStyle: string; backgroundColor: string; plugins: readonly unknown[] };
    };
    expect(expo.userInterfaceStyle).toBe('automatic');
    expect(expo.backgroundColor).toBe('#000000');
    const splash = expo.plugins.find((plugin): plugin is readonly [string, { backgroundColor: string }] => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    expect(splash?.[1].backgroundColor).toBe('#1b0e0e');
  });
});
