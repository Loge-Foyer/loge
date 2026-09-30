import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { requireNativeModule, requireNativeView, SharedObject } from 'expo';

/**
 * The Expo module in `android/`: an mpv core as a shared object, and the
 * surface it draws into. Reached lazily — the module exists in an Android
 * build only, and merely importing this package must not fail anywhere else.
 */

/** A track as mpv lists it: its own id, and what the file says about it. */
export interface NativeTrack {
  readonly id: number;
  readonly title?: string;
  /** As the file writes it — mostly ISO 639. */
  readonly language?: string;
  /** FFmpeg's name: `eac3`, `subrip`, `hdmv_pgs_subtitle`. */
  readonly codec?: string;
}

export type NativeState = 'loading' | 'buffering' | 'playing' | 'paused' | 'ended';

export type NativeEvents = {
  state(event: { readonly state: NativeState }): void;
  position(event: { readonly positionMs: number; readonly durationMs?: number }): void;
  tracks(event: { readonly audio: readonly NativeTrack[]; readonly subtitles: readonly NativeTrack[] }): void;
  error(event: { readonly message: string }): void;
};

export declare class NativePlayer extends SharedObject<NativeEvents> {
  /** mpv sends any header a stream needs, unlike most engines. */
  load(uri: string, headers: Readonly<Record<string, string>> | null, startMs: number | null): Promise<void>;
  play(): void;
  pause(): void;
  /** Plays again from here: after the end mpv holds the last frame, so this is a seek. */
  replay(startMs: number): void;
  seek(positionMs: number): void;
  /** `-1` turns it off. */
  setAudioTrack(id: number): void;
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
  module ??= requireNativeModule<NativeModule>('ScMpv');
  return module;
}

export function nativeView(): ComponentType<NativeViewProps> {
  view ??= requireNativeView<NativeViewProps>('ScMpv');
  return view;
}
