import { useState, type ComponentType, type ReactNode, type Ref } from 'react';
import { Platform, Pressable, type GestureResponderEvent, type StyleProp, type View, type ViewStyle } from 'react-native';

/** A TV — tvOS or Android TV — driven by a remote: focus moves, and select presses what has it. */
export const isTV = Platform.isTV === true;

/**
 * A phone or a tablet: a finger on the picture. The player's edges live here
 * alone — a television's volume is the television's, and a browser has a
 * pointer, not a thumb at the side of the screen.
 */
export const isHandheld = !isTV && process.env.EXPO_OS !== 'web';

/**
 * Something a TV remote can press. Tamagui's controls hear touches alone, and
 * a remote's select arrives as a click that only React Native's own Pressable
 * hears — so on a TV a control is drawn inside one, which takes the focus and
 * the select, and says when it has the focus so the control can show it.
 */
export function Remote({
  ref,
  onPress,
  disabled,
  preferred = false,
  onFocus,
  onBlur,
  style,
  children,
}: {
  /** The remote's own control, which `requestTVFocus()` sends the focus to. */
  ref?: Ref<View>;
  onPress: ((event: GestureResponderEvent) => void) | null | undefined;
  disabled?: boolean | null | undefined;
  /** Where the focus starts on the screen that holds it. */
  preferred?: boolean;
  /** Told as the remote lands on it and leaves it. */
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  children: (focused: boolean) => ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...(ref ? { ref } : {})}
      {...(onPress ? { onPress } : {})}
      disabled={disabled ?? false}
      hasTVPreferredFocus={preferred}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
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

/**
 * A focused card's ring without the lift, for a card whose size is its own to
 * change — a row's card that widens as it takes the focus, whose neighbours
 * move by its width and not by a scale they cannot know.
 */
export const CARD_RING = {
  rounded: '$5',
  outlineColor: '$accent10',
  outlineWidth: 4,
  outlineStyle: 'solid',
  outlineOffset: 3,
} as const;

/**
 * How far a focused card's picture reaches past its own box on a TV, for a
 * picture `height` tall: lifted by `CARD_FOCUSED`'s scale, then ringed. The
 * words beneath keep this much clear and a row keeps it free above, or the
 * ring is drawn through the title and cut off at the row's edge. None
 * anywhere else.
 */
export const cardFocusRoom = (height: number) =>
  isTV ? Math.ceil((height * (CARD_FOCUSED.scale - 1)) / 2) + CARD_FOCUSED.outlineOffset + CARD_FOCUSED.outlineWidth : 0;

/** How a focused control looks on a TV: lifted, and ringed in the accent. */
export const FOCUSED = {
  scale: 1.06,
  outlineColor: '$accent10',
  outlineWidth: 3,
  outlineStyle: 'solid',
  outlineOffset: 2,
} as const;

/**
 * How far a focused control — a chip, a pill — reaches past its own box on a
 * TV, lifted and ringed: enough for one up to about a hundred points tall. A
 * scroll view of them clips what reaches past it, so it leaves this much room
 * round them, and pulls itself out by as much so nothing moves
 * (`focusRoomStyles`). None anywhere else.
 */
export const FOCUS_ROOM = isTV ? 12 : 0;

/** For a horizontal scroll view of controls: room round them for the ring, taken back outside. */
export const focusRoomStyles = isTV
  ? { style: { margin: -FOCUS_ROOM }, contentContainerStyle: { padding: FOCUS_ROOM } }
  : { style: undefined, contentContainerStyle: undefined };

type Pressing = {
  readonly onPress?: ((event: GestureResponderEvent) => void) | null | undefined;
  readonly disabled?: boolean | null | undefined;
  readonly hasTVPreferredFocus?: boolean | undefined;
  readonly onFocus?: unknown;
  readonly onBlur?: unknown;
  readonly ref?: unknown;
} & Readonly<Record<string, unknown>>;

/**
 * A Tamagui control a remote can press. On a TV it is drawn inside `Remote`,
 * and given `focused` while the remote is on it; anywhere else it is the
 * control itself, untouched. It keeps the control's type and its parts —
 * `Button.Text` — so it stands in wherever the control did. On a TV its
 * `onFocus`, `onBlur` and `ref` are the remote's own control's.
 */
export function remotely<C extends ComponentType<never>>(Control: C, focused: object = FOCUSED): C {
  if (!isTV) return Control;
  const Inner = Control as unknown as ComponentType<Pressing>;
  function OnTV(props: Pressing) {
    const { onPress, disabled, hasTVPreferredFocus, onFocus, onBlur, ref, ...rest } = props;
    if (!onPress) return <Inner {...props} />;
    return (
      <Remote
        onPress={onPress}
        disabled={disabled}
        preferred={hasTVPreferredFocus === true}
        {...(typeof onFocus === 'function' ? { onFocus: onFocus as () => void } : {})}
        {...(typeof onBlur === 'function' ? { onBlur: onBlur as () => void } : {})}
        {...(ref ? { ref: ref as Ref<View> } : {})}
      >
        {(hasFocus) => <Inner {...rest} disabled={disabled} focusable={false} {...(hasFocus ? focused : {})} />}
      </Remote>
    );
  }
  return Object.assign(OnTV, Control) as unknown as C;
}
