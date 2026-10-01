import { useTVEventHandler, type HWEvent } from 'react-native';

/** The remote's buttons a screen may act on. Arrows also move the focus, whatever a screen does with them. */
export type RemoteKey = 'select' | 'playPause' | 'left' | 'right' | 'up' | 'down';

const KEYS: ReadonlySet<string> = new Set<RemoteKey>(['select', 'playPause', 'left', 'right', 'up', 'down']);

/**
 * A TV remote's buttons, for a screen that does something with them — the
 * player. Off a TV none ever arrives. The web has no TV events at all, and
 * `use-remote-keys.web.ts` stands in there.
 */
export function useRemoteKeys(onKey: (key: RemoteKey) => void) {
  useTVEventHandler((event: HWEvent) => {
    // Android TV says a key twice, going down and coming up: act once.
    if (event.eventKeyAction === 0) return;
    if (KEYS.has(event.eventType)) onKey(event.eventType as RemoteKey);
  });
}
