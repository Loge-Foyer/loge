import type { PlayerViewProps } from '@sc/player-kit';

import { engineOf } from './engine';
import { idOf, nativeView } from './native';

/** Draws the controller's libVLC player. The controls are the app's, the same for every engine. */
export function VlcPlayerView({ player, style, fit = 'contain' }: PlayerViewProps) {
  const engine = engineOf(player);
  if (!engine) throw new Error('VLC’s view draws VLC’s controllers only.');
  const Surface = nativeView();
  return <Surface player={idOf(engine)} fit={fit} {...(style === undefined ? {} : { style })} />;
}
