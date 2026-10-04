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

## The tabs, down the left

The tvOS tab bar runs across the top, over each tab's page, and a page with
a bar of its own at the top — Media's — had two. So on a TV the tabs are a
rail down the left (`components/tv-tabs.tsx`):

- **UIKit cannot do it.** On tvOS a `UITabBarController` has no sidebar —
  its `UITabBarControllerModeTabSidebar` is marked unavailable there, and only
  SwiftUI's `TabView` has one — so react-native-screens' native tabs keep the
  bar on top. The rail is expo-router's headless tabs (`expo-router/ui`), as
  the browser's top bar is; phones keep the native bar.
- **Loge's icon heads it**, in the symbols' column, where the remote never
  lands (`components/app-mark.tsx`).
- **Its geometry:** the symbols' column starts inside the title-safe margin,
  and each tab's page starts just far enough right that its own margin — the
  80-point gutter — puts what it shows clear of the rail. The rail is the
  page's own colour, so a row scrolled under it disappears into it.
- **Opening:** while the focus is in the rail it widens to show the names,
  over the page, on a veil. The rail is a focus group, which says when the
  focus comes in and goes.
- **Select changes the tab and sends the focus into the page** — the page is
  a focus group too, and `requestTVFocus()` on it lands on what the remote
  last left there, or on the first control of a page it has not been in —
  so the rail closes behind it.
- **Menu on a tab's first screen leaves the app**: there is no system tab bar
  for it to go to first.

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
- **A remote-pressable control reports its own focus**: `remotely()` hands a
  control's `onFocus`, `onBlur` and `ref` to the remote's own `Pressable`, so
  a row of chips can choose as the remote rests on one (`SourceTabs`'
  `selectOnFocus`) and a page can send the remote back to its first one.
- **Cards are `Pressable` already**, and only show the focus
  (`useRemoteFocus`): the picture lifts and wears the ring. That reaches past
  the card — `cardFocusRoom` says how far — so its words sit that much
  lower, and a row's scroll view leaves the room above, where it would cut
  the ring off. Media's TV rows ring their card without the lift
  (`CARD_RING`): a lift would move it by an amount its neighbours cannot
  know.
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
  Who is watching and a profile's PIN are pushed too
  (`profileGateOptions`): as modals they were a card in the middle of the
  screen, and the picker could not put the focus on the profile in use.
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
- **Where the focus starts:** the first card of the home, Play or Resume on
  a title's page, the profile in use in who's watching — at launch, the
  default one — and play/pause in the player. `docs/ui/media` has Media's
  table, panels included.
- **A pushed page with layers of its own** — a title's page with a panel
  open, who's watching with its name field — closes them on Back before it
  leaves (`useBackLayers`): it holds Menu for the app only while a layer is
  open, so Menu leaves the page as ever once none is, and the focus goes back
  to what opened the layer. Never give it a layer in a browser, whose
  `BackHandler` logs an error.

`docs/ui` has the TV layouts.

## Scrolling with the focus

A row that keeps the focused card at its left margin, and a page that holds
the row the remote is in near its top, are react-native-tvos' own snapping,
which scrolls in one motion with the focus engine's own — never a scroll of
the app's, which would fight it:

- **The scroll view has `snapToAlignment="item"`**, and each card's slot or
  each row is wrapped in a `SnapPoint` (`components/snap-point.tsx`):
  `align="start"` puts its leading edge at `snapToItemPadding`, `offset` at a
  fixed distance. The marker must stay a real view — one flattened away says
  nothing, and nothing says so — so `SnapPoint` is `collapsable={false}`.
- **The outermost marker wins**, walking up from the focused view to the
  scroll view, which is how a card's slot steers its row and the row steers
  the page. The axis is the scroll view's content: wider than itself is
  horizontal.
- **The snap never scrolls above 0.** A page with automatic insets rests at a
  negative offset under the tab bar it would never come back to, so Media's
  home keeps its top in its content (`contentInsetAdjustmentBehavior="never"`),
  and a row keeps room after its last card for that one to reach the margin.
- **What the remote reaches must not move or grow as the focus moves.** A
  card that widened its own frame when focused, beside cards moved along by a
  transform, sent the next press of right straight to the end of the row —
  and so did a focus guide laid over the whole row. Media's cards keep the
  poster's frame and only draw the scene wider, and its rows are no focus
  groups (`docs/ui/media`).
- **Animations that run together stop together**: an `Animated.parallel`
  whose scene had been taken away left a card wide and in the way. Each runs
  on its own, on the native driver.

## Who's watching

The TV has a picker of its own (`screens/profile-picker/tv.tsx`), pushed for
the reason above:

- **A photograph fills the screen**, one of seven bundled in
  `assets/backgrounds`, darkened from the left so the profiles read over it.
  One at random as it opens; after 20 to 45 seconds another fades in over it,
  and so on, but only while the screen is in front and the app is. With Reduce
  Motion on, the next one simply replaces it.
- **Its credit is at the bottom right** — the photographer, and Unsplash's mark
  and name — and changes with it. The photographs come from Unsplash, under
  its licence rather than the AGPL (`NOTICE`).
- **The profiles run down the left**, squares in slots of one height. The one
  the remote is on grows and wears the ring, and its name fades in beside it;
  the others show their faces alone. It grows as it is drawn, not as it is laid
  out, so nothing else moves.
- **While the app runs, a pencil** sits beside the focused profile, one press
  of left away, and opens its page in Settings.
- **+ comes last**, gone at the account's limit. It turns into a name field
  with Add, the field takes the focus, and select brings up the keyboard. Back
  puts the field away before it leaves the screen (`useBackLayers`, which holds
  Menu for the app while the field is open).

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
