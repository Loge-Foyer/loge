import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { requireNativeModule, requireNativeView, SharedObject } from 'expo';

/**
 * The Expo module in `android/` and `ios/`: libVLC's player as a shared
 * object, and the view it draws into. Reached lazily — the module exists in a
 * native build only, and merely importing this package must not fail anywhere
 * else.
 */

/** A track as libVLC lists it: its own id, and a name it makes up — "Track 1 - [English]". */
export interface NativeTrack {
  readonly id: number;
  readonly name: string;
}

export type NativeState = 'loading' | 'buffering' | 'playing' | 'paused' | 'ended';

export type NativeEvents = {
  state(event: { readonly state: NativeState }): void;
  position(event: { readonly positionMs: number; readonly durationMs?: number }): void;
  tracks(event: { readonly audio: readonly NativeTrack[]; readonly subtitles: readonly NativeTrack[] }): void;
  error(event: { readonly message: string }): void;
};

export declare class NativePlayer extends SharedObject<NativeEvents> {
  /** libVLC takes a user agent and a referrer, and no other header. */
  load(uri: string, userAgent: string | null, referrer: string | null, startMs: number | null): Promise<void>;
  play(): void;
  pause(): void;
  /** Opens the stream anew and plays it from here: after its end, libVLC plays a stream again no other way. */
  replay(startMs: number): void;
  seek(positionMs: number): void;
  /** How fast it plays, 1 being normal. */
  setRate(rate: number): void;
  /** How loud, 0 to 100 — libVLC's own scale. */
  setVolume(volume: number): void;
  setAudioTrack(id: number): void;
  /** `-1` turns subtitles off. */
  setSubtitleTrack(id: number): void;
}

interface NativeModule {
  readonly Player: typeof NativePlayer;
}

export interface NativeViewProps {
  /** The player's id: see `idOf`. */
  readonly player: number;
  readonly fit: 'contain' | 'cover';
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * A player as its view is handed it: by its id, as expo-video hands its own.
 * React Native's development renderer deep-freezes every prop a native view
 * mounts with, and a frozen player can no longer be released.
 */
export function idOf(player: NativePlayer): number {
  return (player as unknown as { readonly __expo_shared_object_id__: number }).__expo_shared_object_id__;
}

let module: NativeModule | undefined;
let view: ComponentType<NativeViewProps> | undefined;

export function nativeModule(): NativeModule {
  module ??= requireNativeModule<NativeModule>('LogeVlc');
  return module;
}

export function nativeView(): ComponentType<NativeViewProps> {
  view ??= requireNativeView<NativeViewProps>('LogeVlc');
  return view;
}
