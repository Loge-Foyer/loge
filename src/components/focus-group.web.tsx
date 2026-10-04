import type { ComponentRef, ReactNode, Ref } from 'react';
import { View, type StyleProp, type TVFocusGuideView, type ViewStyle } from 'react-native';

export type FocusSide = 'up' | 'down' | 'left' | 'right';

export type FocusGroupHandle = ComponentRef<typeof TVFocusGuideView>;

/** A browser is not a TV: no remote to steer, and a row is only a view. */
export function FocusGroup({
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
  return <View style={style}>{children}</View>;
}
