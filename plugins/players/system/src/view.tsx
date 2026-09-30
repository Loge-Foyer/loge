import type { PlayerViewProps } from '@sc/player-kit';
import { VideoView } from 'expo-video';

import { engineOf } from './engine';

/** Draws the controller's expo-video player. The controls are the app's, the same for every engine, so the engine's own stay hidden. */
export function SystemPlayerView({ player, style, fit = 'contain' }: PlayerViewProps) {
  const engine = engineOf(player);
  if (!engine) throw new Error('The built-in player’s view draws the built-in player’s controllers only.');
  return <VideoView player={engine} nativeControls={false} contentFit={fit} style={style} />;
}
