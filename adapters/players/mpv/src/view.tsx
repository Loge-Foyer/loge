import type { PlayerViewProps } from '@loge/player-kit';

import { engineOf } from './engine';
import { idOf, nativeView } from './native';

/** Draws the controller's mpv core. The controls are the app's, the same for every engine. */
export function MpvPlayerView({ player, style, fit = 'contain' }: PlayerViewProps) {
  const engine = engineOf(player);
  if (!engine) throw new Error('mpv’s view draws mpv’s controllers only.');
  const Surface = nativeView();
  return <Surface player={idOf(engine)} fit={fit} {...(style === undefined ? {} : { style })} />;
}
