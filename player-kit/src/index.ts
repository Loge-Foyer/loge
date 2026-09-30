/**
 * The React half of the player contract. `@sc/api` defines the controller,
 * `MediaPlayer`, and imports nothing; drawing an engine's pixels needs React,
 * so the view's contract lives here. A player plugin exports both, and only
 * the app's composition root imports it.
 */
import type { MediaPlayer, Plugin, PlayerRole } from '@sc/api';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export interface PlayerViewProps {
  /** The controller this view draws: one the same plugin created. */
  readonly player: MediaPlayer;
  readonly style?: StyleProp<ViewStyle>;
  /** How the picture fills the view: whole and letterboxed, or cropped to fill it. */
  readonly fit?: 'contain' | 'cover';
}

/**
 * Draws a controller's picture and nothing else. The controls — scrubbing,
 * tracks, next episode — are the app's, the same for every engine.
 */
export type PlayerView = ComponentType<PlayerViewProps>;

/** A player plugin: its manifest and role, as `@sc/api` knows them, and the view that draws them. */
export interface PlayerPlugin extends Plugin {
  readonly player: PlayerRole;
  readonly View: PlayerView;
}
