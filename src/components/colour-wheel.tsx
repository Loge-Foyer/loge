import { useId, useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { Circle, Defs, Path, RadialGradient, Stop, Svg } from 'react-native-svg';
import { useTheme } from 'tamagui';

import { hsvToHex } from './colour';
import { px } from './density';

/** Where a finger is on the wheel: the hue round it, and how far out — the saturation. */
export interface WheelPoint {
  readonly hue: number;
  readonly saturation: number;
}

const WEDGES = 90;
const STEP = 360 / WEDGES;
// Each wedge reaches half a degree into the next: edges that only met would
// each be smoothed against what is behind them, and a hairline would show.
const OVERLAP = 0.5;
const HUES = Array.from({ length: WEDGES }, (_, index) => index * STEP);

// A browser would scroll or zoom the page under a finger dragging the wheel.
const WEB_TOUCH = process.env.EXPO_OS === 'web' ? ({ touchAction: 'none' } as unknown as ViewStyle) : undefined;

/** What the wheel's touch needs from the latest render. */
interface WheelState {
  readonly view: View | null;
  readonly radius: number;
  readonly onChange: (point: WheelPoint) => void;
  readonly onCommit: (point: WheelPoint) => void;
}

/**
 * One responder for the wheel's life, which keeps a drag to itself — a scroll
 * or a sheet asking for it is refused — and reads the finger against where
 * the wheel sits in the window. `locationX` would be measured from whatever
 * the finger is over, the thumb as much as the wheel. Made afresh on every
 * render, as the player's edges once were, a drag's moves would reach a
 * responder that had never granted it.
 */
function wheelResponder() {
  let wheel: WheelState | undefined;
  let origin: { readonly x: number; readonly y: number } | undefined;
  let finger: { readonly x: number; readonly y: number } | undefined;
  let point: WheelPoint | undefined;

  const read = () => {
    if (!wheel || !origin || !finger) return;
    const { radius } = wheel;
    const dx = finger.x - origin.x - radius;
    const dy = finger.y - origin.y - radius;
    point = {
      // Red at the right, the hue climbing counter-clockwise; up the screen is down its y.
      hue: ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360,
      saturation: radius > 0 ? Math.min(1, Math.hypot(dx, dy) / radius) : 0,
    };
    wheel.onChange(point);
  };
  // Measured once it is laid out, and again as a finger lands, in case the
  // page has moved since. A phone answers at once; a browser a moment later,
  // and the finger is read again then.
  const measure = () =>
    wheel?.view?.measureInWindow((x, y) => {
      origin = { x, y };
      read();
    });
  const follow = (event: GestureResponderEvent) => {
    finger = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    read();
  };
  // Where it got to stands, even when the system took the drag away.
  const finish = () => {
    if (point) wheel?.onCommit(point);
    finger = undefined;
    point = undefined;
  };
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      measure();
      follow(event);
    },
    onPanResponderMove: follow,
    onPanResponderRelease: finish,
    onPanResponderTerminate: finish,
  });
  return {
    handlers: responder.panHandlers,
    measure,
    follow: (latest: WheelState) => {
      wheel = latest;
    },
  };
}

/**
 * A hue and saturation wheel, `size` across, drawn at `value`'s brightness:
 * the hue round it, white towards the middle, black over it all as the
 * brightness falls. `onChange` follows a finger; `onCommit` is where it
 * lifted. The brightness is the caller's own slider.
 */
export function ColourWheel({
  hue,
  saturation,
  value,
  size,
  onChange,
  onCommit,
}: {
  hue: number;
  saturation: number;
  value: number;
  size: number;
  onChange: (point: WheelPoint) => void;
  onCommit: (point: WheelPoint) => void;
}) {
  const box = useRef<View>(null);
  const [touch] = useState(wheelResponder);
  const radius = size / 2;
  useLayoutEffect(() => {
    touch.follow({ view: box.current, radius, onChange, onCommit });
  });
  const thumb = px(28);
  const angle = (hue * Math.PI) / 180;
  const colour = hsvToHex(hue, saturation, value);
  return (
    <View
      ref={box}
      onLayout={touch.measure}
      accessible
      aria-label={`Colour wheel, ${colour}`}
      style={[{ width: size, height: size }, WEB_TOUCH]}
      {...touch.handlers}
    >
      <Disc size={size} value={value} />
      <View
        style={{
          position: 'absolute',
          left: radius + saturation * radius * Math.cos(angle) - thumb / 2,
          top: radius - saturation * radius * Math.sin(angle) - thumb / 2,
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          // White, and shadowed, so it shows on the white middle and the black alike.
          borderWidth: 3,
          borderColor: '#ffffff',
          backgroundColor: colour,
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.5)',
          pointerEvents: 'none',
        }}
      />
    </View>
  );
}

/** The wheel itself, which a drag leaves alone: only the brightness redraws it. */
function Disc({ size, value }: { size: number; value: number }) {
  const theme = useTheme();
  // Ids are the whole page's in a browser, so two wheels must not share one.
  const whiten = `whiten${useId().replace(/[^\w-]/g, '')}`;
  const radius = size / 2;
  return (
    <Svg width={size} height={size} style={{ pointerEvents: 'none' }}>
      <Defs>
        {/* As much white as saturation leaves out: all of it in the middle, none at the rim. */}
        <RadialGradient id={whiten} cx="50%" cy="50%" r="50%">
          <Stop offset={0} stopColor="#ffffff" stopOpacity={1} />
          <Stop offset={1} stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {HUES.map((hue) => (
        <Path key={hue} d={wedge(hue, radius)} fill={`hsl(${hue + STEP / 2}, 100%, 50%)`} />
      ))}
      <Circle cx={radius} cy={radius} r={radius} fill={`url(#${whiten})`} />
      <Circle cx={radius} cy={radius} r={radius} fill="#000000" opacity={1 - value} />
      {/* So a wheel turned black on a black page is still there to touch. */}
      <Circle cx={radius} cy={radius} r={radius - 0.5} fill="none" stroke={String(theme.borderColor.val)} strokeWidth={1} />
    </Svg>
  );
}

/** One wedge, from `hue` round to the next and a little past it. */
function wedge(hue: number, radius: number): string {
  const at = (degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return `${radius + radius * Math.cos(angle)} ${radius - radius * Math.sin(angle)}`;
  };
  // Counter-clockwise on the screen, the way the hue climbs: sweep flag 0.
  return `M ${radius} ${radius} L ${at(hue)} A ${radius} ${radius} 0 0 0 ${at(hue + STEP + OVERLAP)} Z`;
}
