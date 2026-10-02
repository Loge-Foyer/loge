import type { NativeModule } from 'expo';

export type VolumeEvents = {
  onChange(event: { readonly volume: number }): void;
};

/** Declared as the player plugins declare theirs: a class, so its events come with it. */
export declare class VolumeModule extends NativeModule<VolumeEvents> {
  /** The media volume as the system has it, 0 to 1; `null` where the device will not say. */
  get(): number | null;
  set(value: number): Promise<void>;
  /** While the player is open. On iPhone it keeps the system's own volume banner away, as the player shows its own. */
  attach(): Promise<void>;
  release(): Promise<void>;
}
