import type { PlayerViewProps } from '@loge/player-kit';
import { VideoView } from 'expo-video';
import { useSyncExternalStore } from 'react';

import { engineOf, pictureInPictureOf, watchPictureInPicture } from './engine';

/** Draws the controller's expo-video player. The controls are the app's, the same for every engine, so the engine's own stay hidden. */
export function SystemPlayerView({ player, style, fit = 'contain' }: PlayerViewProps) {
  const engine = engineOf(player);
  if (!engine) throw new Error('The built-in player’s view draws the built-in player’s controllers only.');
  // The system enters picture in picture by itself as the app is left, from
  // the view's flag, so the flag follows the app's every word: armed while
  // the film plays, and never while it is paused or over. Nothing here starts
  // it by hand, so allowing it stays on — a window already open is not shut
  // because its film was paused inside it.
  const armed = useSyncExternalStore(
    (listener) => watchPictureInPicture(player, listener),
    () => pictureInPictureOf(player),
  );
  return (
    <VideoView
      player={engine}
      nativeControls={false}
      allowsPictureInPicture
      startsPictureInPictureAutomatically={armed}
      contentFit={fit}
      style={style}
    />
  );
}
