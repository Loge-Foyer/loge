import { describe, expect, it } from 'vitest';

import { clearOf, hexOf, hexToHsv, hsvToHex, isHex, withAlpha } from '@/components/colour';
import { themes } from '@/tamagui.themes';

const named: Readonly<Record<string, Readonly<Record<string, unknown>>>> = themes;

// What the theme hands a component: whole-percent hsla(), as Tamagui emits it.
function emitted(theme: string, key: string): string {
  const found = named[theme]?.[key];
  if (typeof found !== 'string') throw new Error(`${theme} has no ${key}`);
  return found;
}

describe('hue, saturation and brightness', () => {
  it.each([
    ['red', '#ff0000', { hue: 0, saturation: 1, value: 1 }],
    ['a grey', '#808080', { hue: 0, saturation: 0, value: 128 / 255 }],
    ['black', '#000000', { hue: 0, saturation: 0, value: 0 }],
    ['white', '#ffffff', { hue: 0, saturation: 0, value: 1 }],
  ] as const)('carry %s there and back', (_name, hex, hsv) => {
    expect(hexToHsv(hex)).toEqual(hsv);
    expect(hsvToHex(hsv.hue, hsv.saturation, hsv.value)).toBe(hex);
  });

  it('bring every preset back exactly as it was', () => {
    for (const hex of ['#1f2a44', '#0f4c5c', '#5c1a2b', '#1d3b2a']) {
      const hsv = hexToHsv(hex);
      expect(hsv && hsvToHex(hsv.hue, hsv.saturation, hsv.value)).toBe(hex);
    }
  });

  it('go round the wheel: green at a third, blue at two, and round again', () => {
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
    expect(hsvToHex(360, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(-120, 1, 1)).toBe('#0000ff');
  });

  it('give no colour at no brightness, and white at no saturation, whatever the hue', () => {
    expect(hsvToHex(200, 1, 0)).toBe('#000000');
    expect(hsvToHex(200, 0, 1)).toBe('#ffffff');
  });

  it('write lowercase #rrggbb, and read the short form and either case', () => {
    expect(hsvToHex(30, 0.5, 0.8)).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexToHsv('#F00')).toEqual(hexToHsv('#ff0000'));
    expect(hexToHsv('#FF0000')).toEqual(hexToHsv('#ff0000'));
  });

  it('read nothing from what is not a hex', () => {
    expect(hexToHsv('accent')).toBeUndefined();
    expect(hexToHsv('hsla(0, 0%, 0%, 1)')).toBeUndefined();
  });
});

describe('isHex', () => {
  it.each(['#1f2a44', '#1F2A44', '#abc'])('takes %s', (text) => {
    expect(isHex(text)).toBe(true);
  });

  it.each(['1f2a44', '#1f2a4', '#1f2a44ff', '#ggg000', 'accent', ''])('refuses %j', (text) => {
    expect(isHex(text)).toBe(false);
  });
});

describe('withAlpha', () => {
  it.each([
    ['#1f2a44', 0.5, 'rgba(31, 42, 68, 0.5)'],
    ['#fff', 0.3, 'rgba(255, 255, 255, 0.3)'],
    ['rgb(10, 20, 30)', 0.16, 'rgba(10, 20, 30, 0.16)'],
    ['rgba(10, 20, 30, 0.9)', 0.1, 'rgba(10, 20, 30, 0.1)'],
    ['hsl(39, 67%, 55%)', 0.5, 'hsla(39, 67%, 55%, 0.5)'],
    ['hsla(39, 67%, 55%, 1)', 0.16, 'hsla(39, 67%, 55%, 0.16)'],
    ['hsl(39 67% 55% / 1)', 0.5, 'hsla(39, 67%, 55%, 0.5)'],
  ] as const)('puts %s at %s', (colour, alpha, expected) => {
    expect(withAlpha(colour, alpha)).toBe(expected);
  });

  it('keeps the share between none and all, without a float’s tail', () => {
    expect(withAlpha('#000000', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('#000000', -1)).toBe('rgba(0, 0, 0, 0)');
    expect(withAlpha('#000000', 1 - 0.7)).toBe('rgba(0, 0, 0, 0.3)');
  });

  it('draws nothing for a colour it cannot read, rather than the wrong one', () => {
    expect(withAlpha('white', 0.5)).toBe('transparent');
    expect(withAlpha('', 0.5)).toBe('transparent');
  });

  it('takes the accent as the theme emits it, in both schemes', () => {
    for (const scheme of ['dark', 'light']) {
      expect(withAlpha(emitted(scheme, 'accentBackground'), 0.5)).toMatch(/^hsla\([\d.]+, [\d.]+%, [\d.]+%, 0\.5\)$/);
    }
  });
});

describe('clearOf', () => {
  it('is the same colour with none of it showing — never clear black, which greys a fade on white', () => {
    expect(clearOf(emitted('dark', 'background'))).toBe('hsla(0, 0%, 0%, 0)');
    expect(clearOf(emitted('light', 'background'))).toBe('hsla(0, 0%, 100%, 0)');
    expect(clearOf('#ffffff')).toBe('rgba(255, 255, 255, 0)');
    expect(clearOf('rgb(1, 2, 3)')).toBe('rgba(1, 2, 3, 0)');
  });

  it('is transparent for a colour it cannot read', () => {
    expect(clearOf('white')).toBe('transparent');
  });
});

describe('hexOf', () => {
  it('turns the theme’s accent into a hex the wheel can start from', () => {
    for (const scheme of ['dark', 'light']) {
      const hex = hexOf(emitted(scheme, 'accentBackground'));
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(hexToHsv(hex ?? '')?.saturation).toBeGreaterThan(0);
    }
  });

  it('reads every form the same', () => {
    for (const red of ['#ff0000', '#F00', 'rgb(255, 0, 0)', 'rgb(100%, 0%, 0%)', 'hsl(0, 100%, 50%)', 'hsla(360, 100%, 50%, 0.2)']) {
      expect(hexOf(red)).toBe('#ff0000');
    }
  });

  it('reads nothing from what is not a colour', () => {
    expect(hexOf('accent')).toBeUndefined();
    expect(hexOf('hsl(a, b, c)')).toBeUndefined();
  });
});
