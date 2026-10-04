import type { ComponentRef, ReactNode, Ref } from 'react';
import { TVFocusGuideView, View, type StyleProp, type ViewStyle } from 'react-native';

import { isTV } from './remote';

export type FocusSide = 'up' | 'down' | 'left' | 'right';

/** What a focus group's `ref` holds on a TV: a focus guide, whose `requestTVFocus()` sends the focus into it. */
export type FocusGroupHandle = ComponentRef<typeof TVFocusGuideView>;

/**
 * A row the remote enters as one: from above or below, the focus lands on the
 * control it last left there — the first, the first time — however far that
 * is from where it came. Off a TV it is only a view. `trap` keeps the focus in
 * unless it leaves downwards, for a panel over the row that opened it; `traps`
 * names the sides one keeps it in by. `onFocusEnter` and `onFocusLeave` say
 * when the focus comes into it and goes, once each, however it moves inside.
 * Its `ref`'s `requestTVFocus()` sends the focus back into it, to the control
 * last left there. The web, which has no TV focus guide, gets
 * `focus-group.web.tsx`.
 */
export function FocusGroup({
  ref,
  trap = false,
  traps,
  onFocusEnter,
  onFocusLeave,
  style,
  children,
}: {
  ref?: Ref<FocusGroupHandle>;
  trap?: boolean;
  traps?: readonly FocusSide[];
  onFocusEnter?: () => void;
  onFocusLeave?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (!isTV) return <View style={style}>{children}</View>;
  const sides: readonly FocusSide[] = traps ?? (trap ? ['up', 'left', 'right'] : []);
  return (
    <TVFocusGuideView
      ref={ref}
      autoFocus
      trapFocusUp={sides.includes('up')}
      trapFocusDown={sides.includes('down')}
      trapFocusLeft={sides.includes('left')}
      trapFocusRight={sides.includes('right')}
      {...(onFocusEnter ? { onFocusEnter: () => onFocusEnter() } : {})}
      {...(onFocusLeave ? { onFocusLeave: () => onFocusLeave() } : {})}
      style={style}
    >
      {children}
    </TVFocusGuideView>
  );
}
