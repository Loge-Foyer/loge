/**
 * Colours as the app keeps and draws them. A colour someone picks is kept as
 * `#rrggbb`, lowercase; the theme's arrive as Tamagui emits them, `hsla()`.
 * No React Native import, so a test reads it as it is.
 */

export type Hex = `#${string}`;

/** A hue in degrees, 0 to 360; how much of it, and how bright, 0 to 1. */
export interface Hsv {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
}

type Rgb = readonly [number, number, number];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FUNCTION = /^(rgb|hsl)a?\(([^)]*)\)$/i;

/** `#rrggbb`, or the short `#rgb`, in either case. */
export function isHex(text: string): text is Hex {
  return HEX.test(text);
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function channelsOfHex(text: string): Rgb | undefined {
  if (!isHex(text)) return undefined;
  const digits = text.length === 4 ? [...text.slice(1)].map((digit) => digit + digit).join('') : text.slice(1);
  const channel = (at: number) => Number.parseInt(digits.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/** `rgb()` or `hsl()`, with or without the `a`, commas or spaces: which, and its first three channels as written. */
function partsOf(colour: string): { readonly kind: 'rgb' | 'hsl'; readonly channels: readonly [string, string, string] } | undefined {
  const match = FUNCTION.exec(colour);
  const kind = match?.[1]?.toLowerCase();
  const [first, second, third] = (match?.[2] ?? '').split(/[\s,/]+/).filter((part) => part !== '');
  if ((kind !== 'rgb' && kind !== 'hsl') || first === undefined || second === undefined || third === undefined) return undefined;
  return { kind, channels: [first, second, third] };
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const reach = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return 255 * (lightness - reach * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

function rgbOf(colour: string): Rgb | undefined {
  const text = colour.trim();
  const hex = channelsOfHex(text);
  if (hex) return hex;
  const parts = partsOf(text);
  if (!parts) return undefined;
  const [first, second, third] = parts.channels;
  const [a, b, c] = [Number.parseFloat(first), Number.parseFloat(second), Number.parseFloat(third)];
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) return undefined;
  if (parts.kind === 'hsl') return hslToRgb(((a % 360) + 360) % 360, clamp(b / 100, 0, 1), clamp(c / 100, 0, 1));
  // A channel may be written as a share of 255.
  const scale = (part: string, value: number) => (part.endsWith('%') ? (value / 100) * 255 : value);
  return [scale(first, a), scale(second, b), scale(third, c)];
}

function toHex(rgb: Rgb): Hex {
  return `#${rgb.map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

/** Any colour read here — the theme's `hsla()` included — as `#rrggbb`. */
export function hexOf(colour: string): Hex | undefined {
  const rgb = rgbOf(colour);
  return rgb ? toHex(rgb) : undefined;
}

export function hsvToHex(hue: number, saturation: number, value: number): Hex {
  const sector = (((hue % 360) + 360) % 360) / 60;
  const s = clamp(saturation, 0, 1);
  const v = clamp(value, 0, 1);
  const channel = (n: number) => {
    const k = (n + sector) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return toHex([channel(5), channel(3), channel(1)]);
}

/** A grey has no hue of its own, and black no saturation either: both come back as 0. */
export function hexToHsv(hex: string): Hsv | undefined {
  const rgb = channelsOfHex(hex.trim());
  if (!rgb) return undefined;
  const [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  const hue = range === 0 ? 0 : max === r ? 60 * (((g - b) / range + 6) % 6) : max === g ? 60 * ((b - r) / range + 2) : 60 * ((r - g) / range + 4);
  return { hue, saturation: max === 0 ? 0 : range / max, value: max };
}

/**
 * The same colour, with only `alpha` of it showing, whatever it had before.
 * One this cannot read comes back `transparent`: drawn as nothing rather than
 * as the wrong colour.
 */
export function withAlpha(colour: string, alpha: number): string {
  const share = Number(clamp(alpha, 0, 1).toFixed(3));
  const text = colour.trim();
  const hex = channelsOfHex(text);
  if (hex) return `rgba(${hex.join(', ')}, ${share})`;
  const parts = partsOf(text);
  return parts ? `${parts.kind}a(${parts.channels.join(', ')}, ${share})` : 'transparent';
}

/**
 * The same colour with none of it showing. A native gradient interpolates
 * each channel, so fading from `transparent` — clear black — darkens the
 * middle of the fade; the theme's colours arrive as `hsla()`, not hex.
 */
export function clearOf(colour: string): string {
  return withAlpha(colour, 0);
}
