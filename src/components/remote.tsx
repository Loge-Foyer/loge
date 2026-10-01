import { useState, type ComponentType, type ReactNode } from 'react';
import { Platform, Pressable, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

/** A TV — tvOS or Android TV — driven by a remote: focus moves, and select presses what has it. */
export const isTV = Platform.isTV === true;

/**
 * Something a TV remote can press. Tamagui's controls hear touches alone, and
 * a remote's select arrives as a click that only React Native's own Pressable
 * hears — so on a TV a control is drawn inside one, which takes the focus and
 * the select, and says when it has the focus so the control can show it.
 */
export function Remote({
  onPress,
  disabled,
  preferred = false,
  style,
  children,
}: {
  onPress: ((event: GestureResponderEvent) => void) | null | undefined;
  disabled?: boolean | null | undefined;
  /** Where the focus starts on the screen that holds it. */
  preferred?: boolean;
  style?: StyleProp<ViewStyle>;
  children: (focused: boolean) => ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...(onPress ? { onPress } : {})}
      disabled={disabled ?? false}
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...(style ? { style } : {})}
    >
      {children(focused)}
    </Pressable>
  );
}

/**
 * For what is a React Native Pressable already, and so pressable with a remote
 * as it is: whether the remote is on it, and the handlers that keep that
 * known. Nothing focuses it off a TV, so there it stays false.
 */
export function useRemoteFocus(onFocus?: () => void) {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    handlers: {
      onFocus: () => {
        setFocused(true);
        onFocus?.();
      },
      onBlur: () => setFocused(false),
    },
  } as const;
}

/** How a focused card looks on a TV: its picture lifted and ringed in the accent. */
export const CARD_FOCUSED = {
  scale: 1.08,
  rounded: '$5',
  outlineColor: '$accent10',
  outlineWidth: 4,
  outlineStyle: 'solid',
  outlineOffset: 3,
} as const;

/** How a focused control looks on a TV: lifted, and ringed in the accent. */
export const FOCUSED = {
  scale: 1.06,
  outlineColor: '$accent10',
  outlineWidth: 3,
  outlineStyle: 'solid',
  outlineOffset: 2,
} as const;

type Pressing = {
  readonly onPress?: ((event: GestureResponderEvent) => void) | null | undefined;
  readonly disabled?: boolean | null | undefined;
  readonly hasTVPreferredFocus?: boolean | undefined;
} & Readonly<Record<string, unknown>>;

/**
 * A Tamagui control a remote can press. On a TV it is drawn inside `Remote`,
 * and given `focused` while the remote is on it; anywhere else it is the
 * control itself, untouched. It keeps the control's type and its parts —
 * `Button.Text` — so it stands in wherever the control did.
 */
export function remotely<C extends ComponentType<never>>(Control: C, focused: object = FOCUSED): C {
  if (!isTV) return Control;
  const Inner = Control as unknown as ComponentType<Pressing>;
  function OnTV(props: Pressing) {
    const { onPress, disabled, hasTVPreferredFocus, ...rest } = props;
    if (!onPress) return <Inner {...props} />;
    return (
      <Remote onPress={onPress} disabled={disabled} preferred={hasTVPreferredFocus === true}>
        {(hasFocus) => <Inner {...rest} disabled={disabled} focusable={false} {...(hasFocus ? focused : {})} />}
      </Remote>
    );
  }
  return Object.assign(OnTV, Control) as unknown as C;
}
