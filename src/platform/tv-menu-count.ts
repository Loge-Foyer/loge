import type { TvMenu } from '@/services/ports';

/**
 * Menu kept for the app by as many screens as ask, and given back with the
 * last: React Native's own switch is one global flag, so whoever turned it
 * off first would take it from the rest. Apart from React Native and the
 * module, so a test can count.
 */
export function countedTvMenu(deps: {
  /** Whether there is a Menu button to keep: an Apple TV with the module in its build. */
  available(): boolean;
  /** React Native's switch, which routes Menu to `BackHandler`. */
  enable(): void;
  disable(): void;
  /** Keeps UIKit's own Menu handling off, or gives it back. Applied again on every hold, as UIKit re-arms it. */
  native(on: boolean): void;
}): TvMenu {
  let holds = 0;
  return {
    hold: () => {
      if (!deps.available()) return () => undefined;
      holds += 1;
      if (holds === 1) deps.enable();
      deps.native(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds > 0) return;
        deps.native(false);
        deps.disable();
      };
    },
    refresh: () => {
      if (holds > 0) deps.native(true);
    },
  };
}
