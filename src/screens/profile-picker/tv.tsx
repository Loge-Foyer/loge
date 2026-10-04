import type { AppUser, UserId } from '@loge/api';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { Pencil } from '@tamagui/lucide-icons-2/icons/Pencil';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, View, type AppStateStatus } from 'react-native';
import { Circle, H1, SizableText, Theme, useTheme, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';
import { PrimaryButton } from '@/components/primary-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { CARD_RING, useRemoteFocus } from '@/components/remote';
import { TextInput } from '@/components/text-input';
import { UnsplashMark } from '@/components/unsplash-mark';
import { useBackLayers } from '@/hooks/use-back-layers';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

import { BACKGROUNDS, type Background } from './backgrounds';
import { useProfilePicker, type PickerMode } from './use-profile-picker';

/** A TV's title-safe top and bottom: 60 points of 1080. */
const SAFE_Y = px(40);
/** Every profile the same height, so the one that grows moves none of the others. */
const SLOT = px(150);
const AVATAR = px(96);
/** How much larger the profile the remote is on is drawn — drawn, never laid out. */
const LIFT = 1.3;
/** How far a grown avatar and its ring reach past the avatar's own box. */
const REACH = Math.ceil((AVATAR * (LIFT - 1)) / 2 + (CARD_RING.outlineWidth + CARD_RING.outlineOffset) * LIFT);
/** The pencil's column, at the gutter, left of the avatars. */
const EDIT = px(56);
/** Where an avatar starts: clear of the pencil, however far it grows. */
const AVATAR_AT = EDIT + REACH + px(12);
const NAME_WIDTH = px(320);
const LIFT_MS = 160;
const FADE_MS = 1_200;
/** How long a photograph stays: never the same, so the change does not tick like a clock. */
const STAY_MS = { least: 20_000, most: 45_000 } as const;

/**
 * Who's watching on a TV, driven by a remote: a photograph behind everything,
 * changing now and then, and down the left the profiles — the one the remote
 * is on grown, ringed and named, the others their faces alone. While the app
 * runs, a pencil beside it, one press of left away, opens that profile's page
 * in Settings. + names a new profile, and Back puts the name away before it
 * leaves the screen.
 */
export function TvProfilePicker({ mode }: { mode: PickerMode }) {
  const picker = useProfilePicker(mode);
  const reduce = useReduceMotion();
  // Where the focus goes once something new asks for it: the profile just
  // added, or + when the name field is put away.
  const [target, setTarget] = useState<UserId | 'add'>();
  // The profile whose row the remote is in — on its face or on its pencil.
  const [current, setCurrent] = useState<UserId>();
  const startsOn = target ?? picker.startsOn;
  // Back puts the name field away before it leaves the screen, and + takes the focus back.
  useBackLayers(picker.adding ? picker.closeAdding : undefined);

  return (
    <Theme name="dark">
      <YStack flex={1} bg="$background">
        <Backdrop reduce={reduce} />
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ paddingTop: SAFE_Y, paddingBottom: SAFE_Y, paddingHorizontal: GUTTER }}
          showsVerticalScrollIndicator={false}
        >
          <H1 size="$9" color="$color12" pb="$3">
            Who’s watching?
          </H1>
          {picker.profiles.map((profile) => (
            <ProfileSlot
              key={profile.id}
              profile={profile}
              preferred={profile.id === startsOn}
              raised={profile.id === current}
              reduce={reduce}
              disabled={picker.choosing}
              onFocus={() => setCurrent(profile.id)}
              onPress={() => picker.choose(profile.id)}
              {...(mode === 'switch' ? { onEdit: () => picker.edit(profile.id) } : {})}
            />
          ))}
          {picker.full ? null : picker.adding ? (
            <XStack height={SLOT} items="center" gap="$3" pl={AVATAR_AT}>
              <TextInput
                width={NAME_WIDTH}
                value={picker.name}
                onChangeText={picker.setName}
                placeholder="Name"
                returnKeyType="done"
                onSubmitEditing={() => picker.add((user) => setTarget(user.id))}
                aria-label="New profile name"
                // The remote lands on the field in place of +, and select brings up the keyboard.
                hasTVPreferredFocus
                onFocus={() => setCurrent(undefined)}
              />
              <PrimaryButton onPress={() => picker.add((user) => setTarget(user.id))} disabled={picker.addPending}>
                Add
              </PrimaryButton>
            </XStack>
          ) : (
            <AddSlot
              preferred={startsOn === 'add'}
              reduce={reduce}
              onFocus={() => setCurrent(undefined)}
              onPress={() => {
                setTarget('add');
                setCurrent(undefined);
                picker.openAdding();
              }}
            />
          )}
          {picker.addError ? (
            <SizableText size="$4" color="$red11" pl={AVATAR_AT}>
              {picker.addError}
            </SizableText>
          ) : null}
        </ScrollView>
      </YStack>
    </Theme>
  );
}

function ProfileSlot({
  profile,
  preferred,
  raised,
  reduce,
  disabled,
  onFocus,
  onPress,
  onEdit,
}: {
  profile: AppUser;
  preferred: boolean;
  /** The remote is in its row: on the avatar or on the pencil beside it. */
  raised: boolean;
  reduce: boolean;
  disabled: boolean;
  onFocus: () => void;
  onPress: () => void;
  /** While the app runs: that profile's page in Settings. */
  onEdit?: () => void;
}) {
  const { focused, handlers } = useRemoteFocus(onFocus);
  const { lift, scale } = useLift(raised, reduce);
  return (
    <XStack height={SLOT} items="center">
      <YStack width={EDIT} items="center">
        {onEdit && raised ? <Button chromeless circular size="$4" icon={Pencil} aria-label={`Edit ${profile.name}`} onPress={onEdit} /> : null}
      </YStack>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hasTVPreferredFocus={preferred}
        accessibilityRole="button"
        accessibilityLabel={profile.pinProtected ? `${profile.name}, PIN required` : profile.name}
        style={{ marginLeft: AVATAR_AT - EDIT }}
        {...handlers}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <YStack position="relative" {...(focused ? CARD_RING : {})} rounded="$4">
            <ProfileAvatar user={profile} size={AVATAR} shape="square" />
            {profile.pinProtected ? (
              <Circle size={px(28)} bg="$color3" position="absolute" b={px(6)} r={px(6)} borderWidth={px(2)} borderColor="$background">
                <Lock size={px(14)} color="$color11" />
              </Circle>
            ) : null}
          </YStack>
        </Animated.View>
      </Pressable>
      <Named opacity={lift}>{profile.name}</Named>
    </XStack>
  );
}

/** + at the end of the column, hidden at the account's limit; it grows and names itself as a profile does. */
function AddSlot({ preferred, reduce, onFocus, onPress }: { preferred: boolean; reduce: boolean; onFocus: () => void; onPress: () => void }) {
  const { focused, handlers } = useRemoteFocus(onFocus);
  const { lift, scale } = useLift(focused, reduce);
  return (
    <XStack height={SLOT} items="center">
      <Pressable
        onPress={onPress}
        hasTVPreferredFocus={preferred}
        accessibilityRole="button"
        accessibilityLabel="Add a profile"
        style={{ marginLeft: AVATAR_AT }}
        {...handlers}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <YStack
            width={AVATAR}
            height={AVATAR}
            borderWidth={px(2)}
            borderColor="$color7"
            items="center"
            justify="center"
            {...(focused ? CARD_RING : {})}
            rounded="$4"
          >
            <Plus size={px(40)} color="$color12" />
          </YStack>
        </Animated.View>
      </Pressable>
      <Named opacity={lift}>Add profile</Named>
    </XStack>
  );
}

/** The name to the right of a grown avatar, fading in as it grows. */
function Named({ opacity, children }: { opacity: Animated.Value; children: ReactNode }) {
  return (
    <Animated.View style={{ opacity, marginLeft: REACH + px(16) }}>
      <SizableText size="$8" fontWeight="700" color="$color12" numberOfLines={1} maxW={NAME_WIDTH}>
        {children}
      </SizableText>
    </Animated.View>
  );
}

/** 0 at rest and 1 grown: a quick ease, or at once where the device asks for less motion. */
function useLift(raised: boolean, reduce: boolean) {
  const [motion] = useState(() => {
    const lift = new Animated.Value(raised ? 1 : 0);
    return { lift, scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, LIFT] }) };
  });
  useEffect(() => {
    if (reduce) {
      motion.lift.setValue(raised ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(motion.lift, {
      toValue: raised ? 1 : 0,
      duration: LIFT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [raised, reduce, motion]);
  return motion;
}

/** One photograph on the screen, and how much of it shows. */
interface Layer {
  readonly id: number;
  readonly photo: number;
  readonly opacity: Animated.Value;
}

/** A photograph at random — any but the one showing. */
function pick(except?: number): number {
  const count = BACKGROUNDS.length;
  if (except === undefined || count < 2) return Math.floor(Math.random() * count);
  const other = Math.floor(Math.random() * (count - 1));
  return other >= except ? other + 1 : other;
}

const stay = () => STAY_MS.least + Math.random() * (STAY_MS.most - STAY_MS.least);

/**
 * The photograph behind everything, with its credit. One at random first;
 * then, after 20 to 45 seconds while this screen is in front and the app is,
 * another fades in over it — or replaces it at once, where the device asks
 * for less motion. Nothing ticks while anything else is in front.
 */
function Backdrop({ reduce }: { reduce: boolean }) {
  const focused = useIsFocused();
  const active = useAppActive();
  const [layers, setLayers] = useState<readonly Layer[]>(() => [{ id: 0, photo: pick(), opacity: new Animated.Value(1) }]);
  const latest = layers[layers.length - 1]?.id ?? 0;

  useEffect(() => {
    if (!focused || !active) return undefined;
    const timer = setTimeout(() => {
      setLayers((now) => {
        const showing = now[now.length - 1];
        const next: Layer = { id: (showing?.id ?? 0) + 1, photo: pick(showing?.photo), opacity: new Animated.Value(0) };
        // The one showing stays beneath until the next covers it; anything older goes now.
        return showing ? [showing, next] : [next];
      });
    }, stay());
    return () => clearTimeout(timer);
  }, [focused, active, latest]);

  // Each fades in only once it has loaded, so it never fades in as nothing;
  // then what it covers goes.
  const reveal = (layer: Layer) => {
    const settle = () => setLayers((now) => now.filter((each) => each.id >= layer.id));
    if (reduce) {
      layer.opacity.setValue(1);
      settle();
      return;
    }
    Animated.timing(layer.opacity, { toValue: 1, duration: FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished) settle();
    });
  };
  // A photograph that cannot be drawn is skipped, and the one beneath stays.
  const skip = (layer: Layer) => setLayers((now) => (now.length > 1 ? now.filter((each) => each.id !== layer.id) : now));

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {layers.map((layer) => {
        const background = BACKGROUNDS[layer.photo];
        return background ? (
          <Animated.View key={layer.id} style={[StyleSheet.absoluteFill, { opacity: layer.opacity }]}>
            <Photo background={background} onLoad={() => reveal(layer)} onError={() => skip(layer)} />
          </Animated.View>
        ) : null;
      })}
    </View>
  );
}

/**
 * A photograph, darkened from the left for the column of profiles and softly
 * at the bottom right for its credit — each layer whole, so a photograph and
 * its credit change together.
 */
function Photo({ background, onLoad, onError }: { background: Background; onLoad: () => void; onError: () => void }) {
  const theme = useTheme();
  // The gradients are drawn natively, so they take the dark theme's page resolved, at its own see-through steps.
  const page = String(theme.background.val);
  const clear = String(theme.background0.val);
  return (
    <>
      {/* It ships with the app rather than coming from a source, so there is
          no reference for `Artwork` to resolve: expo-image draws it as it is. */}
      <Image source={background.source} contentFit="cover" contentPosition={background.position} style={StyleSheet.absoluteFill} onLoad={onLoad} onError={onError} />
      <LinearGradient
        colors={[page, String(theme.background08.val), String(theme.background04.val), clear]}
        locations={[0, 0.28, 0.5, 0.72]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient colors={[String(theme.background06.val), clear]} start={{ x: 1, y: 1 }} end={{ x: 0.55, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <YStack position="absolute" r={GUTTER} b={SAFE_Y} items="flex-end" gap="$1">
        <SizableText size="$5" fontWeight="700" color="$color12">
          {background.photographer}
        </SizableText>
        <XStack items="center" gap="$2">
          <UnsplashMark size={px(12)} color={String(theme.color11.val)} />
          <SizableText size="$3" color="$color11">
            Unsplash
          </SizableText>
        </XStack>
      </YStack>
    </>
  );
}

const inFront = (state: AppStateStatus) => state !== 'background' && state !== 'inactive';

/** Whether the app is in front: a TV sent to its home screen keeps no timer going here. */
function useAppActive() {
  const [active, setActive] = useState(() => inFront(AppState.currentState));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(inFront(state)));
    return () => subscription.remove();
  }, []);
  return active;
}
