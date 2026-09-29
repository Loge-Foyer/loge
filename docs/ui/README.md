# UI

The visual identity, theming, and the component library. Components take domain
types and never know which plugin produced them.

This page describes the target. Until Phase 6 the app has three tabs — no TV —
Settings → Plugins is one list, and Welcome offers to sign in or to use the
device on its own.

## Tamagui

The app is built with [Tamagui](https://tamagui.dev) 2.7.7 on its `v5` preset.
Every `@tamagui/*` package is pinned to the same exact version — Tamagui is not
tied to an Expo SDK, so nothing else keeps them in step.

There is exactly **one theme entry point**: `src/tamagui.config.ts`. Colours,
spacing and type all come from there; nothing sits beside it.

- **Dark only.** A cool blue-grey "ink" for surfaces and a single teal accent
  for primary actions and selection. No borrowed brand colours.
- **Shorthands.** The v5 preset only accepts the short form of a style prop:
  `bg`, `p`, `px`, `rounded`, `items`, `justify`, `self`, `maxW`…
- **Media queries are min-width**: `$sm` ≥ 640, `$md` ≥ 768, `$lg` ≥ 1024,
  `$xl` ≥ 1280. Card sizes and column counts come from the viewport, so the
  same screens will stretch to a TV.
- **Positioning.** v5 views default to `position: static` on the web. Anything
  laid over something else — badges on a poster, a hero's title, a crop frame —
  needs `position="relative"` on its container, or it lands on the nearest
  positioned ancestor: fine on a phone, broken in a browser.
- **Animations** use the v5 CSS driver: CSS on the web, React Native's Animated
  on devices, from one import.
- **Icons** are Lucide, imported one file at a time
  (`@tamagui/lucide-icons-2/icons/ChevronRight`) so the full set never ships.

## Native where it counts

The tab bar is the platform's own — iOS tabs, Material 3 navigation on
Android — and so are the stack headers, sheets and switches. They are drawn
natively, so they take colours resolved from the Tamagui theme. In a browser the
tabs become a top navigation bar, which is also each tab's header.

`src/components/stack-options.tsx` holds the four kinds of screen: a tab's root
(a large native title, with the tab's actions and the profile switcher at the
right), a full-screen page with its own header, a detail page whose header
floats over the artwork, and a sheet (`formSheet` on iOS and Android, a plain
page in a browser).

## Four tabs

**Media, Videos, TV, Settings.** What appears on each is decided by category
and kind in `services/tab-content.ts` (`docs/plugins`), never by a plugin's
name.

- **Media** — a source's movies, shows and anime, merged across every source.
- **Videos** — web video and files, one tab per source. It shows skeleton
  shelves until a source lists videos or files.
- **TV** — everything IPTV brings, in Live, Movies and Series sections, plus any
  source's `live` channels. Media and Videos never show IPTV content.
- **Settings** — the account, profiles, plugins, about.

Phase 6 gives Videos new icons, gives TV the TV ones, and makes the web's top
bar compact on narrow screens; today it wraps below about 400 px wide.

## Media

**Home** (`screens/media/home.tsx`) is Continue Watching, then one row per kind
in the profile's own order and sort. A row a source cannot fill is hidden; a
source that could not answer gets one line at the top, however many rows it
would have filled; a profile that has not set up a connection sees "Finish
setting up" for it. Pull to refresh on a phone; a Refresh button beside
Customize in a browser, which cannot pull.

**What was saved comes first.** At launch a row shows what its sources answered
last time — a placeholder, never taken for a fresh answer — until they answer
again. When one cannot, what was saved from it stays, and its line says how old
it is: "Home is only used on your home network. Showing what was saved 5 min
ago." The grid shows a saved first page the same way, and pages on only once
the source is back. A detail page opened before comes back with the same line.
All of this only where the source may be kept on the device (`docs/data`).

**Cards** (`components/media/`):

- *Poster* (2:3) — the source's ratings stacked top left (★ community score,
  then critics' %), a check top right once watched, a bar along the bottom while
  partly watched. Watch badges only appear when the source reports watch status
  to this profile.
- *Landscape* (16:9) — for Continue Watching, or any row switched to scenes: the
  frame where playback stopped when a source provides one (none does yet), else
  the episode's still, else the backdrop; "S1 · E3 — Title" or "23 min left"
  below.

**A row's title** opens its grid: a full-screen page over the tab bar, in the
row's own sort, with as many columns as the width allows (`FlashList`, keyed by
the column count). **Detail pages** switch on the item's type — a movie's hero
and cast, a show's seasons and episodes, an episode's still with a way to its
show. Play, Resume, Mark watched and Next episode arrive with playback
(Phase 7, `docs/playback`).

**Customize** is a sheet with everything inline, because a Tamagui portal would
render behind a native sheet: per row, up and down, shown or hidden, sort and
direction, poster or scene cards. Rows a profile adds can be removed; the
default ones can only be hidden. Reset puts the default back.

## TV

The TV tab arrives in Phase 6 with its empty state, which points to Settings →
Plugins → IPTV. Phase 7 fills it:

- **Live** — group chips, the channel list with what is on now and next, and a
  day guide.
- **Movies** and **Series** — the media components, for IPTV content only.
- **Offline** — channels and the guide are kept per profile, like the media
  cache, and shown with how old they are when the provider cannot be reached.

IPTV is hidden on the web until a proxy exists, so in a browser the tab holds
only what sources bring as `live`.

## Settings

- **Account** — local, or on your own server, and how it stands.
- **Profiles** — up to ten on a local account, and up to the server's limit on
  your own server. At the limit, "Add a profile" is hidden and the list says
  why. A profile the server refused for the limit stays on this device only,
  and says so. A local copy kept after signing out that holds more than ten
  keeps them all, but adds none until there are fewer.
- **PIN lock**, per profile.
- **Plugins** — four rows: Sources, IPTV, Players, Sync. Each opens that
  category's list for this platform (`settings/plugins/[category]`), and each
  plugin has its page (`settings/plugins/[category]/[name]`). There is no
  global list.
  - **Sources** and **IPTV** list their connections and add new ones.
  - **Players** list this device's engines: each one's switch and settings,
    and which is the default. Until Phase 7, the built-in player says it is
    not there yet.
  - **Sync** has your own server, the backup targets — iCloud on iOS only,
    Google Drive and OneDrive, as they arrive — and the backup file: Export,
    Import, and Show the backup key, behind the owner check. When a save finds
    the file changed on another device, it asks: open theirs, keep this
    device's, or keep both.
- **About.**

## The connection form

The form is built from the plugin's manifest (`components/manifest-form/`),
switching on `field.type` only; the app has no form of its own for any plugin.
It has one switch of its own, `enabled`, for the whole account, and the
per-profile tabs `docs/plugins` describes. A connection whose plugin cannot run
on this device shows "not available on this device", and its values are kept
for the devices that can.

## The account

**Welcome** (`screens/welcome.tsx`) is the first launch, with three ways in:

- **Create an account on this device** — a name, which the first profile takes
  too, and the app opens on it.
- **Sign in to your server** — its connection fields and nothing else, tried
  once. When the account brings profiles, a spinner holds while the gate moves
  to "Who's watching?".
- **Restore a backup** — a `.scbackup` file and its key.

**Settings → Account** (`screens/settings/account.tsx`) shows the account and how
it stands. On your server: "Synced 5 min ago · 2 changes waiting", Sync now,
what it keeps in step, Switch account and Sign out. An account that refused
the sign-in — its password changed elsewhere — offers "Sign in again", which
takes its password and nothing else; the address and username are read-only,
since another would be another account. On a local account the screen says
everything is kept on this device, and offers to sign in to your server or to
create an account there. A row at the top of Settings says the same in one
line.

**The sign-in flow** (`screens/sign-in-flow.tsx`) is shared by Welcome and
Settings, so it uses no hook that needs a profile: at first launch there is
none. Every step has its own Back, and a sign-in that does not go through says
why in words, never retried.

- **Signing in on a device that holds an account** says what will happen — the
  server's account replaces this device's profiles and sources — offers to
  export a backup first, and asks "Confirm it's you", checked by the account
  being left. Accounts are never merged.
- **Replacing can take the profile in use**, and everything under `(app)` with
  it, so Settings never navigates afterwards; the gate does. Importing a backup
  behaves the same way.

**Creating an account** is the same form. Where the plugin can create one
(`account.signUp`), "New here? Create an account" adds its fields — your own
server's invite code — and the button reads "Create account". From a local
account the form says its profiles and sources will be uploaded, and refuses
up front when there are more profiles than the server takes. Once the account
exists, the form only signs in to it: going back, or a step that fails after,
never tries to create it twice.

**The owner's password** is asked for in a form of its own
(`components/owner-proof-form.tsx`), inline, because a native alert cannot hold
a text field: the fields the account's `ownerProof` names, Continue and Cancel,
"Checking…" while the server answers, and the verdict in words — "That password
isn't right.", or too many tries. Nothing is retried by itself. Sign out opens
it in place of the button, after the confirmation; Forgot PIN opens it in place
of the PIN pad.

**Forgot PIN?** sits under the PIN pad — at launch, when switching, and on PIN
lock's current-PIN step — wherever the owner can be asked: on your server, with
the account's password; otherwise with Face ID, a fingerprint or the passcode.
Where nobody can be asked — a browser on a local account — a hint takes the
link's place, and a server account that no longer lets this device in points
to signing in to it again. A yes clears the PIN and opens the profile; PIN lock
then offers "Set a PIN".

**Screens scroll with taps passing through** (`components/screen.tsx`,
`keyboardShouldPersistTaps="handled"`): otherwise the first tap on a button
after typing only puts the keyboard away, and Continue seems to do nothing.

## Artwork

`components/artwork.tsx` is the only thing that turns an image reference into
pixels. It asks the media service to resolve the reference for its size — a
reference may need a header the component must never see — and draws the
result with `expo-image`: a blurhash while loading, a crop for images cut from
a sheet, and a disk cache only when the source allows it. The resolved source is
memoized, because the web image component fetches again whenever it gets a new
object. Without a reference, or from a source that has no images, a card shows
its title on a colour derived from its key. Channel logos go through the same
resolver.

`components/scrim.tsx` fades artwork into the page with `expo-linear-gradient`,
which takes resolved colours. `pointerEvents` goes in its style: React Native
deprecated the prop.

## On the web

`src/app/_layout.tsx` imports `@tamagui/core/reset.css`. Without it the
browser's own styles leak in — button padding alone squeezes every switch.

Tamagui 2.7.7 warns in development that an `AlertDialogContent` "requires a
description" even when it has one; its check runs before the dialog's portal
mounts. The dialog is correctly described — check `aria-describedby` in the DOM.
