import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** A browser is not a TV: no remote to steer, and a row is only a view. */
export function FocusGroup({ style, children }: { trap?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={style}>{children}</View>;
}
