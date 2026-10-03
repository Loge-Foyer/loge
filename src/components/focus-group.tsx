import type { ReactNode } from 'react';
import { TVFocusGuideView, View, type StyleProp, type ViewStyle } from 'react-native';

import { isTV } from './remote';

/**
 * A row the remote enters as one: from above or below, the focus lands on the
 * control it last left there — the first, the first time — however far that
 * is from where it came. Off a TV it is only a view. `trap` keeps the focus in
 * unless it leaves downwards, for a panel over the row that opened it. The
 * web, which has no TV focus guide, gets `focus-group.web.tsx`.
 */
export function FocusGroup({ trap = false, style, children }: { trap?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  if (!isTV) return <View style={style}>{children}</View>;
  return (
    <TVFocusGuideView autoFocus {...(trap ? { trapFocusUp: true, trapFocusLeft: true, trapFocusRight: true } : {})} style={style}>
      {children}
    </TVFocusGuideView>
  );
}
