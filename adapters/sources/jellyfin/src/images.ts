import { imageRef, type ImageRef, type ImageSize, type ImageSource } from '@loge/api';

import { queryString } from './url';

export type ImageKind = 'Primary' | 'Backdrop' | 'Thumb' | 'Logo';

// A few fixed widths, so every size a layout asks for maps onto a handful of
// cached images instead of one per pixel.
const WIDTHS = [160, 240, 320, 480, 640, 960, 1280, 1920] as const;

/** `i/{itemId}/{kind}/{index|-}/{tag}[/{blurhash}]` — everything needed to build the address later. */
export function itemImage(
  itemId: string,
  kind: ImageKind,
  tag: string,
  extra: { index?: number; blurhash?: string } = {},
): ImageRef {
  const parts = ['i', itemId, kind, extra.index === undefined ? '-' : String(extra.index), tag];
  if (extra.blurhash) parts.push(encodeURIComponent(extra.blurhash));
  return imageRef(parts.join('/'));
}

/** Item images are served without a sign-in, so the address needs no header. */
export function resolveItemImage(baseUrl: string, ref: ImageRef, size: ImageSize): ImageSource | null {
  const [scheme, itemId, kind, index, tag, blurhash] = ref.split('/');
  if (scheme !== 'i' || !itemId || !kind || !tag) return null;
  const path = `/Items/${itemId}/Images/${kind}${index && index !== '-' ? `/${index}` : ''}`;
  return {
    uri: baseUrl + path + queryString({ tag, fillWidth: bucket(size.width), quality: 90 }),
    ...(blurhash ? { blurhash: decodeURIComponent(blurhash) } : {}),
  };
}

export function bucket(width: number): number {
  return WIDTHS.find((candidate) => candidate >= width) ?? WIDTHS[WIDTHS.length - 1] ?? 1920;
}
