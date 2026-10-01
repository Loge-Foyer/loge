import type { PlayerViewProps } from '@sc/player-kit';
import { VideoView } from 'expo-video';

import { engineOf, pictureInPictureOf } from './engine';

/** Draws the controller's expo-video player. The controls are the app's, the same for every engine, so the engine's own stay hidden. */
export function SystemPlayerView({ player, style, fit = 'contain' }: PlayerViewProps) {
  const engine = engineOf(player);
  if (!engine) throw new Error('The built-in player’s view draws the built-in player’s controllers only.');
  // Read as the view mounts, which is after the app has said what it wants:
  // the system enters picture in picture by itself, so the answer has to be in
  // place before the app goes behind anything rather than at that moment.
  const pip = pictureInPictureOf(player);
  return (
    <VideoView
      player={engine}
      nativeControls={false}
      allowsPictureInPicture={pip}
      startsPictureInPictureAutomatically={pip}
      contentFit={fit}
      style={style}
    />
  );
}
