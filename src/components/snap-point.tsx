import type { ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { isTV } from './remote';

/**
 * Where a TV's scroll view puts what holds the focus: at the start of the row
 * (`align`), or at a fixed distance from the top (`offset`). react-native-tvos
 * reads it as the focus moves and scrolls there itself, in one motion with its
 * own, on a scroll view with `snapToAlignment="item"`. The marker must stay a
 * real view — one flattened away says nothing, and nothing says so — hence
 * `collapsable={false}`. Anywhere else it is only a view.
 */
export function SnapPoint({
  align,
  offset,
  style,
  onLayout,
  children,
}: {
  align?: 'start' | 'center' | 'end';
  offset?: number;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  if (!isTV) return <View style={style} {...(onLayout ? { onLayout } : {})}>{children}</View>;
  return (
    <View
      collapsable={false}
      {...(onLayout ? { onLayout } : {})}
      {...(offset === undefined ? {} : { scrollSnapOffset: Math.round(offset) })}
      {...(align === undefined ? {} : { scrollSnapAlign: align })}
      style={style}
    >
      {children}
    </View>
  );
}
