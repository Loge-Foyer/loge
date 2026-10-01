import type { ConnectionId, ImageRef } from '@sc/api';
import { Image, type ImageContentFit } from 'expo-image';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SizableText, YStack } from 'tamagui';

import { useArtwork, useArtworkHeaders } from '@/hooks/use-media';

const HUES = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow', 'teal'] as const;

type Radius = '$0' | '$3' | '$4' | '$5' | '$6' | '$10' | 999;

/**
 * An item's artwork. The only component that ever sees an image address: it
 * asks the media service to resolve the item's reference, and falls back to a
 * plate with the title when the source has no artwork, is not connected yet,
 * or the image fails.
 */
export function Artwork({
  connectionId,
  image,
  width,
  aspect,
  label,
  rounded = '$5',
  fit = 'cover',
  blur,
}: {
  connectionId: ConnectionId;
  image: ImageRef | undefined;
  width: number;
  aspect: number;
  /** Read aloud, and printed on the fallback plate. */
  label: string;
  rounded?: Radius;
  fit?: ImageContentFit;
  /** Softened, for a cover laid behind the page rather than looked at. */
  blur?: number;
}) {
  const height = Math.round(width / aspect);
  const resolved = useArtwork(connectionId, image, width, height);
  const headers = useArtworkHeaders(connectionId, resolved?.headersRef);
  // The same object for the same image: the web image component fetches again for a new one.
  const source = useMemo(() => {
    if (!resolved) return null;
    if (resolved.headersRef && !headers.data) return null;
    return { uri: resolved.uri, ...(headers.data ? { headers: headers.data } : {}) };
  }, [resolved, headers.data]);

  return (
    // Positioned, so the image and the plate fill this box — Tamagui leaves `position` static by default.
    <YStack position="relative" width={width} height={height} rounded={rounded} overflow="hidden" bg="$color3" aria-label={label}>
      <Plate label={label} seed={image ?? label} />
      {source && resolved ? (
        resolved.crop ? (
          <Image
            source={source}
            contentFit="fill"
            cachePolicy={resolved.cachePolicy}
            accessibilityIgnoresInvertColors
            style={{
              position: 'absolute',
              left: -resolved.crop.x * (width / resolved.crop.width),
              top: -resolved.crop.y * (height / resolved.crop.height),
              width: resolved.crop.sheetWidth * (width / resolved.crop.width),
              height: resolved.crop.sheetHeight * (height / resolved.crop.height),
            }}
          />
        ) : (
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit={fit}
            cachePolicy={resolved.cachePolicy}
            recyclingKey={resolved.uri}
            transition={150}
            {...(blur ? { blurRadius: blur } : {})}
            accessibilityIgnoresInvertColors
            {...(resolved.blurhash ? { placeholder: { blurhash: resolved.blurhash } } : {})}
          />
        )
      ) : null}
    </YStack>
  );
}

/** What shows before, or instead of, the image: a tinted plate with the title. */
function Plate({ label, seed }: { label: string; seed: string }) {
  return (
    <YStack position="absolute" t={0} l={0} r={0} b={0} theme={hueFor(seed)} bg="$color4" justify="flex-end" p="$2">
      <SizableText size="$3" fontWeight="700" color="$color11" numberOfLines={3}>
        {label}
      </SizableText>
    </YStack>
  );
}

function hueFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return HUES[hash % HUES.length] ?? 'blue';
}

/**
 * A title's logo, drawn on nothing so its transparency shows the scene behind
 * it. Without one — or while it loads nowhere — `fallback` stands in, usually
 * the title in type.
 */
export function ArtworkLogo({
  connectionId,
  image,
  width,
  height,
  label,
  fallback,
}: {
  connectionId: ConnectionId;
  image: ImageRef | undefined;
  width: number;
  height: number;
  label: string;
  fallback: ReactNode;
}) {
  const resolved = useArtwork(connectionId, image, width, height);
  const headers = useArtworkHeaders(connectionId, resolved?.headersRef);
  const source = useMemo(() => {
    if (!resolved || (resolved.headersRef && !headers.data)) return null;
    return { uri: resolved.uri, ...(headers.data ? { headers: headers.data } : {}) };
  }, [resolved, headers.data]);
  if (!source || !resolved) return <>{fallback}</>;
  return (
    <Image
      source={source}
      style={{ width, height }}
      contentFit="contain"
      contentPosition="left"
      cachePolicy={resolved.cachePolicy}
      accessibilityLabel={label}
    />
  );
}
