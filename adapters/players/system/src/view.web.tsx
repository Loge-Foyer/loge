import type { PlayerViewProps } from '@sc/player-kit';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { engineOf } from './engine.web';

/**
 * Places the controller's own `<video>` on the page. The element belongs to
 * the controller and outlives the view, so a remount never restarts the
 * stream.
 */
export function SystemPlayerView({ player, style, fit = 'contain' }: PlayerViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const video = engineOf(player);
  if (!video) throw new Error('The built-in player’s view draws the built-in player’s controllers only.');

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.display = 'block';
    container.appendChild(video);
    return () => {
      if (video.parentNode === container) container.removeChild(video);
    };
  }, [video]);

  useEffect(() => {
    video.style.objectFit = fit;
  }, [video, fit]);

  return (
    <View style={[{ backgroundColor: 'black', overflow: 'hidden' }, style]}>
      <div ref={host} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}
