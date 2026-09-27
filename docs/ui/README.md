# UI

The visual identity, theming, and the component library. Components take domain
types and never know which plugin produced them.

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
show. There is no Play button until playback exists.

**Customize** is a sheet with everything inline, because a Tamagui portal would
render behind a native sheet: per row, up and down, shown or hidden, sort and
direction, poster or scene cards. Rows a profile adds can be removed; the
default ones can only be hidden. Reset puts the default back.

## The account

**Welcome** (`screens/welcome.tsx`) is the first launch: "Sign in to sync your
profiles" or "Use on this device only". Signing in picks an account — straight
to its form when there is only one kind — asks for its connection fields and
nothing else, and tries once. When the account brings profiles, a spinner holds
while the gate moves to "Who's watching?"; an empty account leads to "Who is
this?", as using the device alone does. A build with no account to sign in to
goes straight to "Who is this?".

**Settings → Account** (`screens/settings/account.tsx`) shows the account and how
it stands — "Synced 5 min ago · 2 changes waiting" — with Sync now, what it
keeps in step, Switch account and Sign out. An account that refused the sign-in,
or let this device go, offers "Sign in again", which takes its passwords and
nothing else. Where the account seals passwords, the list says so, and that it
cannot read them. Without an account the screen says everything is kept on this
device, and offers Sign in. A row at the top of Settings says the same in one
line.

**The sign-in flow** (`screens/sign-in-flow.tsx`) is shared by both, so it uses
no hook that needs a profile: at first launch there is none. Every step has its
own Back, and a sign-in that does not go through says why in words, never
retried. When both sides have profiles it asks once: "Keep both", or "Use the
account's profiles", which asks again before removing this device's own. A
switch asks "Move your profiles and settings to X?" — after "Confirm it's
you", where the account being left checks its owner with its password.
Choosing the account's profiles can take the profile in use, and everything
under `(app)` with it, so Settings never navigates after that; the gate does.

**Creating an account** is the same form. Where the plugin can create one
(`sync.signUp`), "New here? Create an account" adds its fields — your own
server's invite code — and the button reads "Create account". Once the account
exists, the form only signs in to it: going back, or a step that fails after,
never tries to create it twice. While a key is worked out, the form says it can
take a few seconds on a phone.

**The owner's password** is asked for in a form of its own
(`components/owner-proof-form.tsx`), inline, because a native alert cannot hold
a text field: the fields the account's `ownerProof` names, Continue and Cancel,
"Checking…" while the key is worked out, and the verdict in words — "That
password isn't right.", or too many tries. Nothing is retried by itself. Sign
out opens it in place of the button, after the confirmation; Forgot PIN opens
it in place of the PIN pad.

**Forgot PIN?** sits under the PIN pad — at launch, when switching, and on PIN
lock's current-PIN step — wherever the owner can be asked: through the account
(its password, where it asks for one), or with Face ID, a fingerprint or the
passcode. Where nobody can be asked — a browser without an account — it reads
"Forgot it? An account lets you reset a PIN.", or, with an account that no
longer lets this device in, to sign in to it again. A yes clears the PIN and
opens the profile; PIN lock then offers "Set a PIN".

**Screens scroll with taps passing through** (`components/screen.tsx`,
`keyboardShouldPersistTaps="handled"`): otherwise the first tap on a button
after typing only puts the keyboard away, and Continue seems to do nothing.

**The connection form** has one switch, for the media role. The account is not
a switch: a row says "Your account", or points to Settings → Account. On the
account's own connection the details are read-only — another address would be
another account — and neither Remove nor per-profile values are offered. A
plugin that can only be an account offers "Use as your account" on its page;
its `new` route refuses, since no form switches a sync role on.

## Artwork

`components/artwork.tsx` is the only thing that turns an image reference into
pixels. It asks the media service to resolve the reference for its size — a
reference may need a header the component must never see — and draws the
result with `expo-image`: a blurhash while loading, a crop for images cut from
a sheet, and a disk cache only when the source allows it. The resolved source is
memoized, because the web image component fetches again whenever it gets a new
object. Without a reference, or from a source that has no images, a card shows
its title on a colour derived from its key.

`components/scrim.tsx` fades artwork into the page with `expo-linear-gradient`,
which takes resolved colours. `pointerEvents` goes in its style: React Native
deprecated the prop.

## On the web

`src/app/_layout.tsx` imports `@tamagui/core/reset.css`. Without it the
browser's own styles leak in — button padding alone squeezes every switch.

Tamagui 2.7.7 warns in development that an `AlertDialogContent` "requires a
description" even when it has one; its check runs before the dialog's portal
mounts. The dialog is correctly described — check `aria-describedby` in the DOM.

The web's top bar wraps below about 400 px wide. It predates the media screens.
