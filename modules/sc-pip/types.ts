import type { NativeModule } from 'expo';

export type PictureInPictureEvents = {
  onModeChange(event: { readonly inPictureInPicture: boolean }): void;
};

/** Declared as the player plugins declare theirs: a class, so its events come with it. */
export declare class PictureInPictureModule extends NativeModule<PictureInPictureEvents> {
  /** Whether this device has it at all. */
  isAvailable(): boolean;
  /** Let the system shrink the app by itself when it is left. Android 12 and after. */
  setAutoEnter(on: boolean): boolean;
  /** Shrink it now. */
  enter(): boolean;
  isActive(): boolean;
}
