import { useState } from 'react';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SizableText, Slider, XStack, YStack, useTheme } from 'tamagui';

import { Button } from '@/components/button';
import { hexOf, hexToHsv, hsvToHex, type Hsv } from '@/components/colour';
import { ColourWheel, type WheelPoint } from '@/components/colour-wheel';
import { COLUMN, GUTTER, px } from '@/components/density';
import { Glow } from '@/components/glow';
import { CHOSEN } from '@/components/settings-list';
import { useAppSettingActions, useAppSettings } from '@/hooks/use-app-settings';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { APP_DEFAULTS } from '@/services/app-settings';
import type { GlowColour } from '@/services/ports';

/** The accent, then colours deep enough to sit behind white words. */
const PRESETS: readonly { readonly name: string; readonly colour: GlowColour }[] = [
  { name: 'The accent', colour: 'accent' },
  { name: 'Navy', colour: '#1f2a44' },
  { name: 'Teal', colour: '#0f4c5c' },
  { name: 'Wine', colour: '#5c1a2b' },
  { name: 'Forest', colour: '#1d3b2a' },
  { name: 'Black', colour: '#000000' },
];

const BLACK: Hsv = { hue: 0, saturation: 0, value: 0 };
const SWATCH = px(40);

// The chosen swatch is ringed in the fill a chosen option wears, a little
// apart from it, so the accent's own swatch shows its ring too.
const RING = { outlineColor: CHOSEN.bg, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 3 } as const;

/** A glow colour in a row's words: the accent by name, any other by its hex. */
export function glowColourName(colour: GlowColour): string {
  return colour === 'accent' ? 'The accent' : colour.toUpperCase();
}

/** A glow colour as a dot, for a row's icon. */
export function GlowSwatch({ colour }: { colour: GlowColour }) {
  return (
    <YStack
      width={px(20)}
      height={px(20)}
      rounded={px(10)}
      bg={colour === 'accent' ? '$accentBackground' : colour}
      borderWidth={1}
      borderColor="$borderColor"
    />
  );
}

/**
 * Settings → App → Glow colour: a preview of Media's home, a wheel for the
 * hue and saturation, a slider for the brightness, and a few to start from.
 * Nothing here scrolls, so no scroll view or sheet can take a drag from the
 * wheel; a phone on its side puts the wheel beside the rest. A finger moves
 * the preview at once, and the setting is written when it lifts.
 */
export function GlowColourScreen() {
  const theme = useTheme();
  const dimensions = useWindowDimensions();
  const userId = useActiveUserId();
  const name = useProfiles().data?.find((profile) => profile.id === userId)?.name;
  const { data } = useAppSettings();
  const { set } = useAppSettingActions();
  const saved = data?.glowColour ?? APP_DEFAULTS.glowColour;
  const accent = hexOf(String(theme.accentBackground.val));
  const hsvOf = (colour: GlowColour) => hexToHsv(colour === 'accent' ? (accent ?? '#000000') : colour) ?? BLACK;
  // Kept as hue, saturation and brightness rather than read back from a hex:
  // a grey has no hue, and the thumb would jump to the middle as one passed.
  const [picked, setPicked] = useState<{ readonly colour: GlowColour; readonly hsv: Hsv }>();
  const shown = picked?.colour ?? saved;
  const hsv = picked?.hsv ?? hsvOf(saved);
  const [area, setArea] = useState<{ readonly width: number; readonly height: number }>();
  const wide = dimensions.width > dimensions.height;

  const show = (next: Hsv) => setPicked({ colour: hsvToHex(next.hue, next.saturation, next.value), hsv: next });
  const keep = (next: Hsv) => {
    show(next);
    set.mutate({ glowColour: hsvToHex(next.hue, next.saturation, next.value) });
  };
  const choose = (colour: GlowColour) => {
    setPicked({ colour, hsv: hsvOf(colour) });
    set.mutate({ glowColour: colour });
  };
  // Black has no hue to turn: a touch on the wheel there brings the brightness up.
  const onWheel = ({ hue, saturation }: WheelPoint): Hsv => ({ hue, saturation, value: hsv.value > 0 ? hsv.value : 1 });
  const measured = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea((now) => (now?.width === width && now.height === height ? now : { width, height }));
  };

  const size = area ? Math.floor(Math.min(area.width, area.height, px(280))) : 0;
  const previewHeight = px(wide ? 96 : 140);

  const preview = (
    <YStack position="relative" height={previewHeight} rounded="$6" overflow="hidden" bg="$color2" borderWidth={1} borderColor="$borderColor" p="$4">
      <Glow colour={shown} height={previewHeight} />
      <SizableText size="$8" fontWeight="700" color="$color12" numberOfLines={1}>
        {name ? `For ${name}` : 'For you'}
      </SizableText>
    </YStack>
  );

  // The wheel takes whatever room the rest leaves it, up to its own size.
  const wheel = (
    <View style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' }} onLayout={measured}>
      {size > 0 ? (
        <ColourWheel
          hue={hsv.hue}
          saturation={hsv.saturation}
          value={hsv.value}
          size={size}
          onChange={(point) => show(onWheel(point))}
          onCommit={(point) => keep(onWheel(point))}
        />
      ) : null}
    </View>
  );

  const controls = (
    <YStack gap="$4">
      <XStack gap="$3" items="center">
        <SizableText size="$3" color="$color10">
          Brightness
        </SizableText>
        <Slider
          flex={1}
          size="$2"
          min={0}
          max={1}
          step={0.01}
          value={[hsv.value]}
          onValueChange={(next) => show({ ...hsv, value: next[0] ?? hsv.value })}
          onSlideEnd={(_event, next) => keep({ ...hsv, value: next })}
          aria-label="Brightness"
        >
          <Slider.Track>
            <Slider.TrackActive bg="$accent9" />
          </Slider.Track>
          <Slider.Thumb index={0} circular size="$1" />
        </Slider>
      </XStack>
      <XStack>
        <Button size="$3" {...(shown === 'accent' ? CHOSEN : {})} onPress={() => choose('accent')}>
          <Button.Text>Use the accent</Button.Text>
        </Button>
      </XStack>
      <XStack gap="$3" flexWrap="wrap">
        {PRESETS.map((preset) => (
          <Button
            key={preset.colour}
            unstyled
            width={SWATCH}
            height={SWATCH}
            rounded={SWATCH / 2}
            bg={preset.colour === 'accent' ? '$accentBackground' : preset.colour}
            borderWidth={1}
            borderColor="$borderColor"
            pressStyle={{ opacity: 0.7 }}
            aria-label={preset.name}
            {...(preset.colour === shown ? RING : {})}
            onPress={() => choose(preset.colour)}
          />
        ))}
      </XStack>
    </YStack>
  );

  return (
    // Clear of a phone's notch at the sides and of the tab bar beneath, which
    // a page that scrolls is kept clear of by its scroll view.
    <SafeAreaView edges={{ bottom: 'additive', left: 'maximum', right: 'maximum' }} style={{ flex: 1, paddingLeft: GUTTER, paddingRight: GUTTER }}>
      <YStack flex={1} width="100%" maxW={COLUMN} self="center" gap="$4" pt="$4" pb="$4">
        {wide ? (
          <XStack flex={1} gap="$6">
            {wheel}
            <YStack flex={1} gap="$4" justify="center">
              {preview}
              {controls}
            </YStack>
          </XStack>
        ) : (
          <>
            {preview}
            {wheel}
            {controls}
          </>
        )}
      </YStack>
    </SafeAreaView>
  );
}
