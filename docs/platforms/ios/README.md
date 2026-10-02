# iOS

Building and running on simulator and device, native modules, config plugins, and the development build.

The app runs in a **development build**, not Expo Go. The built-in player is
expo-video on AVPlayer (Phase 7), and mpv is an Expo module in its adapter,
autolinked the way the Android half already is. It builds and links but has not
played here yet. VLC is an Expo module in its adapter too, against VLCKit 3.7
(MobileVLCKit here, TVVLCKit on Apple TV); KSPlayer never arrived. Face ID needs the app's usage text,
which Expo Go cannot carry. Picture in picture on
iPhone belongs to mpv's own module, so `modules/loge-pip` is Android-only.
Phase 4's key derivation module went with its vault.

`npm run ios` builds the client and installs it on the simulator; after that,
Metro serves the JavaScript as usual. Change native code, or add a player, and
build again.

## On your own iPhone

```bash
npm run ios:device                               # asks which device
npm run ios:device -- "<device name or UDID>"    # one of: xcrun devicectl list devices
```

A phone you carry gets a **Release build**: the JavaScript compiled into the
app, no development client, no Metro, and nothing attached once it is
installed. It is the build to live with, and the one that leaves the phone
cool.

**Why not the development build.** A development build is tied to the
computer for as long as it runs, and on a phone paired over Wi-Fi all of it
rides the radio:

- it fetches the JavaScript from Metro at every launch — a development
  bundle, unminified, which the phone compiles itself;
- it keeps sockets open to Metro: Fast Refresh, React Native DevTools, and the
  console, which it relays line by line;
- the development client's network inspector copies every response, up to
  1 MB each, to Metro — every poster on a page included;
- React runs its development checks on every render.

A Release build has none of it. Expo links the development client into the
Debug configuration only (`debugOnly` in its module config), and React
Native compiles its own connections out of a Release build. Keep the development build for the
simulator, and for a phone only to debug what only a phone does — on a cable,
and for as long as that takes.

**Not with Xcode's Run button.** It attaches the debugger and streams the
device's log to Xcode while the app runs. `ios:device` installs with Expo's
own installer or `devicectl` and launches the app without attaching anything.

**A cable, when you can.** A phone paired with "Connect via network" installs
over Wi-Fi, and moving a build of this size keeps its radio busy for minutes.
And the first time Xcode prepares a phone for an iOS version, it copies the
phone's system symbols — several gigabytes — which over Wi-Fi is long and
hot. Let that happen once, on a cable, or not at all: `ios:device` does not
need them.

**The data stays.** A Release build installed over a development one is the
same app, signed by the same team, so it keeps the account and everything
else. The development-only adapters — the mock source, portal, account and
backup target — are not in a Release build, and nothing on a phone should
depend on them. It is signed for development, so it installs on phones
registered to the team in `ios.appleTeamId`, and runs for as long as its
provisioning profile lasts.

## Servers over plain HTTP

App Transport Security refuses plain `http` unless the app says otherwise.
`app.json` says otherwise, through `ios.infoPlist`:

```jsonc
"NSAppTransportSecurity": { "NSAllowsArbitraryLoads": true }
```

**Why blanket, rather than an exception per host.** This app's whole job is
reaching servers the user types in at runtime, so there is no list to write at
build time. `NSExceptionDomains` keys are domain names, and it cannot express
an IP literal at all — which is the single most common shape a home media
server takes. And naming a real portal or server in `app.json` would commit
someone's address to the source tree for good. ATS was never protecting this
app's user from their own Jellyfin; it was only stopping them reaching it. The
protections that matter are elsewhere and unchanged: secrets in the keychain,
descriptors in memory only, redacted logs. What is true, and worth saying: over
plain `http` a portal's sign-in and a stream's address cross the network in the
clear. That is a property of the server the user chose, and no client can
repair it.

**`NSAllowsLocalNetworking` is deliberately absent.** On iOS 10 and later,
`NSAllowsArbitraryLoads` is *ignored* when `NSAllowsLocalNetworking`,
`NSAllowsArbitraryLoadsInWebContent` or `…ForMedia` is also present — that
pairing is the old iOS-9 compatibility idiom, and falling back to the narrow
key is its entire purpose. Adding it back silently disables everything above.
Arbitrary loads already covers every address local networking did.

**`NSLocalNetworkUsageDescription` stays, and is not ATS.** It is the reason
iOS shows for the separate local-network privacy prompt, which a request to a
LAN address must pass *as well as* ATS.

**A change here needs a prebuild.** `npm run ios` only prebuilds when `ios/` is
absent, so on this repository it would rebuild the same `Info.plist` and the
change would never land:

```bash
npx expo prebuild -p ios      # not --clean: that discards the Pods install
                              # and any signing team set in Xcode
npx expo config --type introspect   # cheaper: renders the plist without writing
plutil -p ios/Loge/Info.plist
```

Never edit the generated `ios/` folder instead.

The simulator shares the computer's network, so your own server running there
is `http://localhost:8090`. On a real device it is the computer's LAN address,
which is exactly the case the policy above exists for.

## Storage

- **The database** is SQLite in the app's documents folder, which iCloud and
  encrypted backups include: `Documents/SQLite/loge.db` in the
  app's data container (`xcrun simctl get_app_container booted <bundle id>
  data`), which `sqlite3` can open once the app is closed.
- **Secrets** are in the keychain, under two services. `loge.credentials` holds
  passwords and PINs, and an encrypted backup restores them onto a new phone.
  `loge.device` holds session tokens, the device key and the backup key, and
  stays on this phone: a restored phone signs in to each server as a device of
  its own, and opening a `.logebackup` there takes the key, typed in.
- Keychain entries can outlive the app. Uninstalling it does not delete them,
  so starting fresh on a simulator is `xcrun simctl uninstall booted
  <bundle id>` plus `xcrun simctl keychain booted reset`.

## Players

- **AVPlayer**, the built-in player through expo-video (Phase 7), plays HLS and
  progressive files, but **not raw MPEG-TS over HTTP** — it reads MPEG-TS only
  inside HLS. So `players/system`'s `ios` profile omits `mpegts`, on purpose,
  and a channel that only offers `.ts` correctly says it needs another player.
  The IPTV plugin asks the portal for HLS where it can.
- **mpv** draws into an `AVSampleBufferDisplayLayer`, which is also what lets
  the system take it for picture in picture.
- **VLC** is VLCKit 3.7: MobileVLCKit on iPhone and TVVLCKit on Apple TV, the
  same libVLC generation as Android's, so one profile serves both. It draws
  into a plain OpenGL view, which gives the system no layer to take, so VLC
  has no picture in picture here — its profile does not claim it, and the
  player offers none while it plays. It sets its own audio session, and
  `--quiet` with no loggers keeps libVLC from writing a stream's address to
  the device log.
- `players/ksplayer` is a manifest with no profile and is not registered.
- **Licences are settled** (Phase 8): the app is GPL-3.0-or-later, so a player
  may link a GPL engine, and libmpv's build is one. A closed or App Store build
  would need LGPL engines instead — a plan of its own.
- Which players are on, and the default, are this device's settings.

## iCloud

iCloud is iOS only, so its plugins appear only here: `sync/icloud` keeps the
backup file in iCloud Drive, and `sources/icloud-drive` brings files from it.
Both are manifests for now. They need the iCloud entitlements and the Apple
Developer Program, and come in a later phase.

## The backup file

From Phase 6, export goes through the share sheet — to Files, AirDrop,
anywhere — and import through the document picker. The backup key is shown
only after the owner check.

## Forgot PIN and Face ID

On your own server, Forgot PIN asks for the account's password. On a local
account — or when the server has let this device go — it asks the device,
through `expo-local-authentication`: Face ID or Touch ID, falling back to the
passcode. Only `src/platform/owner-authentication.ts` imports it; the web gets
`owner-authentication.web.ts`, which answers "unavailable".

- **Face ID works in the development build**, which carries the app's usage
  text (`faceIDPermission`, set through the module's config plugin in
  `app.json`). Expo Go could not.
- **A simulator has no passcode.** Enrol Face ID in the simulator's Features
  menu to be asked at all. Without it, on a local account, the unlock screen
  shows a hint instead of the "Forgot PIN?" link.

## The simulator

- `npm run ios` builds, installs and opens the development build. Opened again
  by hand, it shows its launcher: pick the running Metro server.
- Deep links use the app's own scheme, `loge://<path>`.

## The app icon

The icon is an Icon Composer document, `assets/loge.icon` (`ios.icon` in
`app.json`), made from the finished design kept at the workspace root
(`.claude/Finished Design/`). Open it in Icon Composer to change it.

- **The background is the document's fill**, a gradient from #7a1422 to
  #2a050b, not a layer. Icon Composer draws a document fill top to bottom and
  ignores an `orientation` on it, so there is none.
- **Two groups, front first**: the front (the play button, the cushion, the
  rail) over the box. Each holds the colour art, hidden in Mono, and the
  white Mono art, shown only there. Mono covers Clear and Tinted.
  - `image-name-specializations` would read as the way to swap art per
    appearance. Icon Composer 27 ignores it, and actool compiles only the
    base images.
  - A layer's default visibility goes inside `hidden-specializations` as
    `{"value": …}`. A plain `hidden` next to it wins over every appearance.
- **PNG layers, not the design's SVGs.** CoreSVG maps the play button's
  stroke gradient apart from its fill and draws a second triangle inside
  it. The 1024² PNGs render as designed.
- **Preview it without Xcode's window**, in any appearance (Default, Dark,
  ClearLight, ClearDark, TintedLight, TintedDark):

  ```bash
  "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" \
    assets/loge.icon --export-image --output-file /tmp/icon.png --platform iOS \
    --rendition Default --width 1024 --height 1024 --scale 1
  ```

  `xcrun actool assets/loge.icon --compile /tmp/icon --platform iphoneos --minimum-deployment-target 16.4 --app-icon loge --output-partial-info-plist /tmp/icon/p.plist`
  compiles it as a build would. `xcrun assetutil --info /tmp/icon/Assets.car`
  lists what came out.
- **Renaming the document needs a clean prebuild.** Expo copies it to
  `ios/Loge/<name>.icon` and names the app icon after it. A prebuild that is
  not clean keeps the old copy too, and actool compiles both.
- Apple TV never reads a `.icon`: `docs/platforms/tvos`.
