import type { NativeModule } from 'expo';

/** Declared as the app's other modules declare theirs. */
export declare class TvMenuModule extends NativeModule {
  /** On: every navigation controller's own Menu tap is off, those that appeared since included. Off: as they were. */
  hold(on: boolean): void;
}
