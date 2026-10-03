# UI

The visual identity, theming, and the component library. Components take domain
types and never know which plugin produced them.

This page describes the target. Today the four tabs, Settings → Adapters' four
lists, Welcome with its three ways in, the sign-in and import flows, Settings →
Account, the backup file, backup targets, the players' switches, and the
player screen with Play, Resume and Mark watched on detail pages are in place.

## Tamagui

The app is built with [Tamagui](https://tamagui.dev) 2.7.7 on its `v5` preset.
Every `@tamagui/*` package is pinned to the same exact version — Tamagui is not
tied to an Expo SDK, so nothing else keeps them in step.

There is exactly **one theme entry point**: `src/tamagui.config.ts`. Colours,
spacing and type all come from there; nothing sits beside it. Its colours are
`src/tamagui.themes.ts`, a module with no React Native import that nothing
but the config and its test reads.

- **Black, grey and white, light and dark, and the icon's brass.** Nothing
  tints what is read: the page and its words are greys alone, and a single
  brass accent marks primary actions, selection and a remote's focus. No
  borrowed brand colours.
  - **Dark** is pure black — an OLED screen's own — with white words; **light**
    is pure white with black ones. Tamagui draws the page from step 2 and
    every see-through shade of it from step 1, so both are the page's colour.
  - A step does one job in both schemes: 3 a field or a chip, 4 a border or a
    button, 8 a field's placeholder (4.6:1 inside it), 10 muted words (8.3 and
    7.8:1), 12 the words themselves.
  - **The fill is accent10 in both.** The dark theme writes accent3 on it; in
    a light theme Tamagui turns the pair round — a pale fill with the bronze
    on it, a cream tint on white — so the light theme and each of its colours
    are given accent10 with accent1 written on it. The light brass ramp is
    deeper than the dark one: accent10 holds 5.4:1 on white as a tab's tint
    or a focus ring.
  - **Status words are step 11** — `$red11`, `$green11`, `$orange11`. Step 10
    is under 4.5:1 on white. An icon, a border or a badge keeps step 10.
  - **What sits on a picture is drawn dark** in either scheme: the player
    (`<Theme name="dark">`, on black), the badges on a poster on their black
    pill (`PILL`), a profile's initial.
  - Tamagui emits the steps as rounded `hsla()`. Check a contrast on what it
    emits, not on the hex in the ramp — `test/theme.test.ts` checks the pairs
    that matter in both schemes, and that the greys are greys.
- **Appearance** is the device's: System, the default, follows the phone, the
  TV or the browser; Light and Dark hold either (Settings → App). The native
  chrome — the tab bar, sheets, alerts, the keyboard — follows the app's
  choice through `Appearance.setColorScheme`, and the root view behind every
  screen takes the page's colour (`expo-system-ui`). The splash keeps the
  icon's velvet (`#1b0e0e`) and its mark in both, as the icon keeps its own.
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
page in a browser). A sheet's page is one scroll view with its title as the
first, sticky row (`components/sheet.tsx`): an iOS form sheet stretches the
scroll view it finds over the whole sheet, and a title beside it ended up
under the content.

## Four tabs

**Media, Videos, TV, Settings.** What appears on each is decided by category
and kind in `services/tab-content.ts` (`docs/adapters`), never by a plugin's
name.

- **Media** — a source's movies, shows and anime, merged across every source.
- **Videos** — web video and files, one tab per source. A source that can
  narrow its search (`media.searchScopes`) puts the choice at the search box's
  left — All, Video, Channel, Playlist — and a channel among the videos is
  drawn round (`components/media/channel-card.tsx`), a playlist with how many
  videos it holds. A channel opens its own page (`screens/media/channel.tsx`):
  its banner and face, how many follow it, what it says about itself, Follow,
  and its sections — Videos, Shorts, Live, Playlists — as a grid that pages on
  as it scrolls. A playlist's page is its videos, in its order, and whose list
  it is; a video's page leads to its channel.
- **TV** — everything IPTV brings, in Live, Movies and Series sections, plus any
  source's `live` channels. Media and Videos never show IPTV content.
- **Settings** — the account, profiles, plugins, about.

Phase 6 gives Videos new icons, gives TV the TV ones, and makes the web's top
bar compact on narrow screens; today it wraps below about 400 px wide.

## Media

**Home** (`screens/media/home.tsx`) is Continue Watching, then Downloaded, then
one row per kind in the profile's own order and sort. Downloaded is this
device's finished copies of the library — a web video kept from Videos stays
Videos' — newest first, as scenes; a card opens the item's page, which opens
with no network at all, and it is hidden where nothing can be kept. A row a source cannot fill is hidden; a
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
  below. In Continue Watching the two halves do different things: the picture,
  marked with a play glyph, resumes it where it stopped, and the words open its
  own page — an episode's, not its show's. A source that cannot play leaves the
  whole card opening the page, as every other row does.

**A row's title** opens its grid: a full-screen page over the tab bar, in the
row's own sort, with as many columns as the width allows (`FlashList`, keyed by
the column count). **Detail pages** switch on the item's type — a movie's hero
and cast, a show's seasons and episodes, an episode's still with a way to its
show. A title's own row is short: Play — or Resume, with a restart symbol
beside it — in the accent, and the eye, outlined until it is watched and
filled once it is. Everything else waits behind "⋯" (`components/more-menu.tsx`):
Play with…, Download and Add to list, each a page of choices in a card that
floats below the top right — React Native's own modal, which sits above every
native screen and takes a remote's focus. On a phone and in a browser "⋯" is
in the header over the artwork; on a TV, which has none, it ends the row.
Settings → App → Buttons shows the row's buttons as symbols, the default, or
with their words; either way each keeps its words for a screen reader. An item with a cover and nothing wider — an IPTV
provider's films and series — gets the cover beside its title over a softened
copy of it, rather than a slice of a portrait stretched across the page; what
a source does not bring (cast, studios, what the file is, watch state) is
simply not there.

**Customize** is a sheet with everything inline, because a Tamagui portal would
render behind a native sheet: per row, up and down, shown or hidden, sort and
direction, poster or scene cards. Rows a profile adds can be removed; the
default ones can only be hidden. Reset puts the default back.

The layout is a preference, so it travels with the profile to every device.
Version 2 brought the Downloaded row: this app adds it to a version 1 layout,
right after Continue Watching, and an app that knows only 1 reads a 2 as no
layout and shows its defaults, rather than drawing a row it does not know.

## TV

`screens/tv.tsx`. With no IPTV connection it shows the way to add one (in a
browser, that providers can't be reached there). Otherwise:

- **One provider at a time** — a pill for each across the top, then Live,
  Movies and Shows as the provider brings them.
- **Live** — group chips (★, then "All", then the provider's), and the
  channels in the provider's own order: logo or number, name, what is on now
  with how far along, and what is next.
- **Where Live opens** on a provider, until a chip is chosen this time: ★ while
  the profile keeps favourites there; else the group it chose there last, on
  this device, while the provider still has it; else All. Nothing is asked of
  the provider until that is known (`openingGroup`, `services/live-groups.ts`).
  The choice is a device setting — never journaled, and gone with its profile
  or its provider; ★ is never kept, since it comes first by itself. On a TV the
  list is at least a screen tall: react-native-tvos sits a list's scroller in a
  focus guide only as tall as what it holds, so a short ★ list stopped part way
  down.
- **★ Favourites** — the profile's own channels on this provider, kept on the
  account so every device has them: numbered ones in their order, the rest by
  name. Pressing and holding a channel — holding select, with a remote — opens
  a menu to add it or take it out (`components/action-menu.tsx`: the system's
  alert on iOS, Android and tvOS, which the remote drives; Tamagui's dialog in
  a browser), and a favourite's name carries a ★. A channel played from the ★
  list zaps through the favourites. The list is the profile's, so only its
  guide is asked of the provider; a search filters it on the device. The guide is asked for the channels near the top, refreshed every five
  minutes. A tap plays the channel; the calendar opens its day
  (`tv/channel/[connectionId]/[channelId]`): today from midnight, what is on
  now marked, and Watch live.
- **In the player**, a channel's group — or the ★ list it was played from —
  slides in from the left, over the picture, from the Channels button or a
  TV remote's left (`docs/playback`). A row there is the TV tab's own, drawn
  compact (`components/media/channel-row.tsx`).
- **Movies** and **Shows** — posters in the provider's own order, one provider,
  never merged with the library; a poster opens the ordinary detail page, with
  Play where the provider can play. Where the app keeps watch status for the
  provider, what was begun comes first — films part-way, and series with an
  episode watched in the last month, saying "S2 · E5" — then the provider's
  pages without them; every card has its check or its bar.
- **Offline** — the groups, each group's first page of channels, each
  channel's day of guide and the first page of films and series are kept per
  profile, where the provider allows it (`offlineMetadata`), and shown with how
  old they are when it cannot be reached.

IPTV is hidden on the web until a proxy exists — except the development mock
portal, which has no portal to be refused by.

## Search

A search box searches the list beneath it and nothing else
(`components/search-field.tsx`): Media's grid, a Videos source, and each of
TV's sections.

- **When it asks.** Once typing stops for two seconds, or at once on the
  keyboard's search key. Videos asks on the key alone: there every search is a
  request to the source. Emptying the box brings the list back at once.
- **Narrowing it.** Where the source can, a choice at the box's left says
  what a search answers with: All, Video, Channel or Playlist. Changing it
  asks again at once for what is typed.
- **The box stays put.** A list is keyed by what it lists — the source, the
  kind — never by the term. The box lives in the list's header, and a list
  remounted for each term took the keyboard away mid-word.
- **Nothing of a search is kept.** Its pages are never saved, and nothing
  saved stands in for a search that fails: the catalogue is not what a search
  for something in it found.

## Settings

- **Account** — local, or on your own server, and how it stands.
- **Profiles** — up to ten on a local account, and up to the server's limit on
  your own server. At the limit, "Add a profile" is hidden and the list says
  why. A profile the server refused for the limit stays on this device only,
  and says so. A local copy kept after signing out that holds more than ten
  keeps them all, but adds none until there are fewer.
- **PIN lock**, per profile, asked on **All devices** — one PIN, kept with the
  account — or on **This device** alone: its own PIN, or none, whatever the
  account says. A personal phone without one, the family's TV with one.
  Changing where it applies asks for the PIN asked for now, and the actions
  beneath take the scope's words ("Set a PIN for this device"). The Profile
  row says which: "On — the same PIN on every device", "Off on this device".
- **Watch status** — which tabs the account keeps watch status on, for the
  sources there that keep none: Media, Videos, TV's films and series. The
  account's, the same for every profile and device; a source that keeps its
  own — a media server — keeps it there.
- **App** — how this device behaves, whoever is watching: its Appearance —
  System, Light or Dark — the tab it opens on
  (Media, Videos or TV), whether it asks who's watching every time it starts
  (on by default on a TV, where whoever picks up the remote is someone else;
  the default profile is kept for when it is off), force landscape on
  playback, and whether a title's buttons show their words beside their
  symbols.
- **Downloads** — Options, what to ask a source for when keeping a copy
  (`settings/downloads/options`); then Downloads, what this device keeps and
  what is still coming down. Options is hidden where nothing can be kept — a
  TV, a browser.
- **Adapters** — five rows: Sources, IPTV, Players, Sync, Metadata. Each opens that
  category's list for this platform (`settings/adapters/[category]`), and each
  plugin has its page (`settings/adapters/[category]/[name]`). There is no
  global list.
  - **Sources** and **IPTV** list their connections and add new ones.
  - **Players** list this device's engines, with "Plays first" or "Off": each
    one's page has its switch and "Play with it first" (`services/players.ts`,
    device settings). Beneath the list, Controls is three tabs: **Controls** —
    how far a seek moves, either side of play, a double tap (on a TV, a double
    press of left or right), press and hold, the time at the right; **Edges**,
    a phone's and a tablet's alone; and **Buttons**, as **Beneath** and
    **Floating**. Decoding and Leaving the player follow.
  - **Sync** has your own server, the backup targets — iCloud on iOS only,
    Google Drive and OneDrive, as they arrive — and the backup file: Export,
    Import, and Show the backup key, behind the owner check. When a save finds
    the file changed on another device, it asks: open theirs, keep this
    device's, or keep both.
  - **Metadata** lists its connections like a source's — TMDB, with your own
    key, its `enabled` switch and Test connection. Its row says which is set
    up. It brings nothing to a tab: watch status the app keeps on TV is keyed
    by what it answers, so a provider's German and English copies of a film
    are one.
- **About** — the version, and every attribution a manifest carries (TMDB's
  notice), by the adapter's name: no screen names a service itself.

## The connection form

The form is built from the plugin's manifest (`components/manifest-form/`),
switching on `field.type` only; the app has no form of its own for any plugin.
It has one switch of its own, `enabled`, for the whole account, and the
per-profile tabs `docs/adapters` describes. A connection whose plugin cannot run
on this device shows "not available on this device", and its values are kept
for the devices that can.

## The account

**Welcome** (`screens/welcome.tsx`) is the first launch, with three ways in:

- **Create an account on this device** — a name, which the first profile takes
  too, and the app opens on it.
- **Sign in to your server** — its connection fields and nothing else, tried
  once. When the account brings profiles, a spinner holds while the gate moves
  to "Who's watching?".
- **Restore a backup** — a `.logebackup` file and its key, through the import
  flow (`screens/import-flow.tsx`), which Settings shares: pick, type the key,
  see what it holds and what it replaces, the owner check, done. It never
  navigates afterwards; the gate moves.

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
to signing in to it again. A yes clears the PIN this device asks for — on This
device, only its own — and opens the profile; PIN lock then offers to set one.

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

An image resolves only through a connected source, and a card is often drawn
before its source is: from what was saved, at launch, or just after a sync
changed the connection. So the media service keeps a generation per connection
that moves when its provider connects, answers or is let go
(`artworkGeneration`), and a card that drew its plate asks again when it moves
— and asks for the source to be connected meanwhile, which needs no network.
The service answers the same object for the same address, so a card asking
again never makes an image load again.

`components/scrim.tsx` fades artwork into the page with `expo-linear-gradient`,
which takes resolved colours. `pointerEvents` goes in its style: React Native
deprecated the prop.

## On a TV

The same screens, read from across a room and driven by a remote
(`docs/platforms/tvos`). Every branch is behind `isTV`, so a phone and a
browser are untouched.

- **The theme scales** (`tamagui.config.ts`): type about 1.6×, spaces, sizes
  and corners 1.5×; breakpoints stay. `components/density.ts` matches it for
  sizes written by hand (`px`), and sets the title-safe gutter (80 points of
  1920) and a wider column.
- **Focus is shown**: a focused button or card lifts and wears an accent ring,
  a settings row lights up, a switch is an On/Off pill.
- **No headers on tab roots or detail pages** — the tvOS tab bar names the
  tab, and Menu goes back — and sheets take the whole screen. Customize and
  Refresh sit at the top of the Media home.
- **The home's spotlight**: above the rows, whatever card the remote is on,
  large — its picture, title, a line of facts and two of overview — following
  the focus. The focus starts on the first card.
- **The player** answers the remote: select brings the controls up with the
  focus on play/pause, the arrows move among them, and a panel takes the
  focus. With them away, a double press of left or right jumps as a double
  tap does; its scrubber is a progress bar (`docs/platforms/tvos`).

## On the web

`src/app/_layout.tsx` imports `@tamagui/core/reset.css`. Without it the
browser's own styles leak in — button padding alone squeezes every switch.

Tamagui 2.7.7 warns in development that an `AlertDialogContent` "requires a
description" even when it has one; its check runs before the dialog's portal
mounts. The dialog is correctly described — check `aria-describedby` in the DOM.
