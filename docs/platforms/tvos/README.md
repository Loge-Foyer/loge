# Apple TV

Building and running on the Apple TV simulator, what is different on a
television, and the traps on the way there.

Apple TV runs the same app — the same screens, services and adapters — built
for tvOS through [react-native-tvos](https://github.com/react-native-tvos/react-native-tvos),
the TV fork of React Native, which Expo supports. TV layouts are branches of
the ordinary screens, not screens of their own (spec §20).

## Building and running

```bash
npm run tvos         # turns ios/ into the Apple TV project if it is not one, then builds and installs
npm start            # Metro, for the development build already installed
npm run ios          # turns ios/ back into the iPhone project if needed, then builds for the phone
npm run tvos:device  # a real Apple TV: a Release build, with nothing tied to this computer
```

- **A real Apple TV gets a Release build**, for the reasons an iPhone does
  (`docs/platforms/ios`, "On your own iPhone") — and it has no cable to fall
  back on: an Apple TV 4K pairs over the network only. Not tried on one yet.
- **One `ios/` folder, two kinds.** Expo's TV support makes the generated
  `ios/` an Apple TV project with `EXPO_TV=1 npx expo prebuild -p ios --clean`,
  and an iPhone one again without it. `scripts/ios-target.js` does whichever
  the script needs, and only when the folder is the other kind — it is a clean
  prebuild and a `pod install` each time, so switching costs a few minutes and
  the next build is a full one.
- **The first build is long.** The precompiled Expo and React Native
  frameworks are iOS-only, so a TV build compiles them from source.
- **No tvOS simulator ships with Xcode.** `xcodebuild -downloadPlatform tvOS`
  fetches the runtime (about 4 GB), which also creates the Apple TV devices.
- **The simulator is DeviceHub** from Xcode 27 on (`Xcode.app/Contents/Applications/DeviceHub.app`).
  Pick the Apple TV in its sidebar, and turn on Device › Keyboard › Keyboard
  Capture: the arrow keys are then the remote's touch surface, Return is
  select, Escape is Menu, and Space is play/pause.
- **Metro needs nothing special.** The TV asks for the same `ios` bundle a
  phone does; the app tells a TV apart at runtime (`Platform.isTV`), not by
  file name. One Metro serves both.

## Why the dependencies look the way they do

- **`react-native` is `npm:react-native-tvos@0.86.3-0`**, for phones too — the
  fork is a superset, and every Expo project in a repository must use the same
  one. Its versions carry a prerelease tag, which semver keeps out of every
  ordinary range, so:
  - `overrides: { "react-native": "$react-native" }` in `package.json` makes
    every package's `react-native` the one copy. Without it npm installed a
    second React Native under react-native-tvos and a third under Tamagui's
    floating-ui, and refused to add any package whose peer range named
    0.86.
  - `expo.autolinking.exclude: ["react-native-tvos"]`: autolinking skips React
    Native by its package name, and the alias's name is react-native-tvos, so
    it linked React Native's own prebuilt-core podspec a second time and
    `pod install` failed.
- **The scene life cycle** (`config-plugins/with-scene-lifecycle.js`). iOS and
  tvOS 27 stop at launch an app built with their SDK that still makes its
  window in the app delegate. Expo 57 ships the scene delegate but its
  template does not use it yet; the plugin names it in the Info.plist and
  leaves the window to it. It applies to the iPhone build as well.
- **`@react-native-tvos/config-tv`** does nothing unless `EXPO_TV=1`: it sets
  the Podfile's platform, the SDK, the device family and a TV launch screen.

## What a TV does not have

Five Expo modules ship no tvOS build — brightness, screen orientation, local
authentication, the document picker and sharing — and Expo's autolinking
leaves them out with a warning. Their JavaScript would throw on import, so the
platform modules that use them load them on first use and have a TV
stand-in:

| | On a TV |
| --- | --- |
| Screen brightness, orientation | nothing to set: the TV's own |
| Face ID, the passcode | unavailable: Forgot PIN uses the account password, as in a browser |
| Export, import, Restore a backup | not offered: no files and no share sheet (`FileExchange.available`) |
| Downloads | none: tvOS gives an app no storage the system will not clear |
| A browser | none: a credit, or Loge's own source, shows its address instead of opening it |

**The device database is a known limit.** SQLite lives in the documents
folder, which the simulator keeps and a real Apple TV does not promise to: an
app there may only keep purgeable caches. A television wants its account on
your own server, which brings it all back; that, and moving the database to
caches, is later work. A PIN the TV keeps for itself goes with a cleared
database, and the TV then asks for the account's: the arrangement that keeps
the TV locked is a PIN on All devices, with the phones that should not ask
choosing This device.

## Players

All three run here: the built-in player (expo-video), mpv (MPVKit's tvOS
slices; its picture-in-picture start is iPhone-only and fenced off), and VLC
(TVVLCKit 3.7, the tvOS build of the same VLCKit as MobileVLCKit). Players
choose by platform, and an Apple TV is `ios` to them. mpv still asks for stereo
— a TV on a receiver would want surround, which needs a real device to test.

## The remote

Tamagui's controls hear touches alone, and the remote's select arrives as a
click that only React Native's own `Pressable` hears. So:

- **Every button comes from `@/components/button`** — lint refuses Tamagui's
  directly — and `remotely()` (`components/remote.tsx`) draws it inside a
  `Pressable` on a TV, with a focus ring. Settings rows, switches (an On/Off
  pill: UIKit has no switch on tvOS) and the primary button do the same.
- **Cards are `Pressable` already**, and only show the focus
  (`useRemoteFocus`).
- **The player** answers the remote (`hooks/use-remote-keys.ts`), and only
  the player in front does: every screen hears the remote, and a zap leaves
  the one before on the screen for a moment.
  - Select brings the controls up — on a film, up and down too — and the
    focus starts on play/pause every time they do. Left and right reach back and forward;
    down goes into the row beneath — audio, subtitles, speed, as Settings
    arranges it — and up into the row at the top. Each row is a focus group
    (`components/focus-group.tsx`), so up and down always land in it, on the
    control last used there. A panel those buttons open takes the focus,
    scrolls, and keeps it until it leaves downwards.
  - With the controls away, left and right are the picture's sides. Pressed
    twice quickly, one flashes and jumps as a double tap does, and the
    controls stay away, so the next double press jumps again; pressed once,
    the controls come up.
  - **A channel is watched with the controls away.** It opens with a banner
    at the bottom — its logo or number, its name, what is on now, when, how
    far along and what it is about, and what is next — and the banner leaves
    five seconds after the picture comes (`components/media/channel-banner.tsx`).
    While it loads, buffers or reconnects, the banner stays, with a spinner;
    a pause brings the controls.
    - Up and down zap — up to the channel above, as ▲ and the channel list
      have it. The banner shows where the presses point at once; the tune
      follows half a second after the last, so a quick run is one new
      stream, not one per press. Past the last channel loaded comes the
      group's next page; round to the first only once the group is all in.
    - Right brings the banner back; select, the controls.
    - Left opens the channel's group, sliding in from the left with the focus
      on the channel playing; up and down move through it, select zaps, and
      right closes it. The live bar's Channels button opens it too while the
      controls are up.
    - Which overlay shows, and where up and down go, are pure
      (`screens/player-layers.ts`: `liveOverlay`, `zapTarget`).
  - Play/pause plays and pauses; the scrubber is a progress bar.
  - While the controls are away, the focus rests on an invisible view over
    the picture, which select presses. The full-screen tap-catcher a phone
    uses is never focusable here: it wraps every control, and holding the
    focus it would never hand it on.
- **The player is pushed, not presented.** tvOS puts a native modal outside
  React Native's root view, where `hasTVPreferredFocus`, `nextFocus*` and a
  focus guide's destinations do nothing (`autoFocus` and the traps still
  work). The sheets, still full-screen modals here, have the same limit.
- **Back (Menu) closes the layer on top** — the channel list, then a panel,
  then the controls, then the banner — and only then the player
  (`backStep` in `screens/player-layers.ts`). A layer counts only where
  hiding it shows something else: the controls a pause holds up are no
  layer, and Back leaves. Android TV's Back reaches the app as it is.
  - **On Apple TV, Menu has to be kept for the app.** A pushed screen sits in
    a `UINavigationController`, and the controller's own Menu tap pops it
    before React Native hears the press — even with
    `TVEventControl.enableTVMenuKey()` on (react-native-screens #4618).
    `modules/loge-tv-menu` switches that recognizer off while the player is in
    front, and keeps it off as UIKit switches it on again with every screen
    that comes and goes. It is react-native-screens' own fix (#4665,
    `disableDefaultMenuAction`), which no release carries yet: delete the
    module once one does.
  - The player takes the hold in a focus effect (`TvMenu` in
    `services/ports.ts`, counted with React Native's one global switch in
    `platform/tv-menu.ts`), takes it again after each transition and on
    coming back to the app, and lets go when anything covers it. Its one
    `BackHandler` listener leaves through `close()`: on tvOS `exitApp` does
    nothing.
- **Where the focus starts:** the first card of the home, Play on a detail
  page, the default profile in the picker, play/pause in the player.

`docs/ui` has the TV layouts.

## The icon and the top shelf

tvOS reads no Icon Composer document. Its icon is a layered image stack, and
config-tv builds it from `appleTVImages` in `app.json` into
`TVAppIcon.brandassets`. On a TV build only, config-tv also names the app
icon `TVAppIcon` after Expo has named it `loge`, so the stack wins. An iPhone
build never sees any of it.

- **`assets/tv/`**, made once from the finished design's 1024² iOS layers
  (`.claude/Finished Design/iOS/Loge/` at the workspace root):
  - **the app icon**, at 400×240, 800×480 and 1280×768, in three layers:
    - back: the design's gradient, #7a1422 to #2a050b along (0, 0) → (0.3, 1)
      of the image;
    - middle: the box;
    - front: the front.

    The art is 60 % of the icon's height, centred, so the parallax has room.
  - **the top shelf**, at 1920×720 and 3840×1440, and wide at 2320×720 and
    4640×1440: the front composited over the box, at half the height,
    centred on the gradient.
- **The back layer has to be an image.** A tvOS stack has no fill, so the
  background is the one picture of a gradient in the app.
- **The iPhone's `loge.icon` rides along.** Expo adds it to every target,
  and with `INCLUDE_ALL_APPICON_ASSETS` actool compiles its four layers into
  the TV build as well, unused. actool raises nothing about it.
- **File names carry their size.** Names inside one image set must differ.
  config-tv reads the paths from the working directory, which is the project
  root when `scripts/ios-target.js` prebuilds.
- **To make them again:** scale each layer so the art (its bounds in the
  1024² layers are 112, 102 – 912, 922) is the share of the height above.
  Place it centred on a transparent canvas of the size, and paint the back
  layer's gradient by its formula.
