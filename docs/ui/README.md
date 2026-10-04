# UI

The visual identity, theming, and the component library. Components take domain
types and never know which plugin produced them.

This page is the system every tab is built from. A content tab's own UI — its
design, its components, its controls — has a page of its own:
[`media/`](media/README.md), and Videos and Live below until theirs are
written.

Media's screens are modelled on the
[Netflix UI 2024](https://www.figma.com/community/file/1348399379890177021/netflix-ui-2024?q_id=242a5470-91b1-46a0-bab2-d555e0ca9e42)
community file on Figma; what stayed Loge's own is in `media/`.

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
  - **What is chosen wears the fill**: a chosen tab, and the option taken in
    a row of choices (`CHOSEN`, `components/settings-list.tsx`). Never
    Tamagui's `accent` theme for it: that theme's page is the ramp's step 2, a
    cream paler than an unchosen button in light and a brown darker than one
    in the dark.
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
tabs become a top navigation bar, which is also each tab's header. On a TV
they run down the left (`components/tv-tabs.tsx`), so the top of the screen
is each tab's own.

`src/components/stack-options.tsx` holds the four kinds of screen: a tab's root
(a large native title, with the tab's actions and the profile switcher at the
right), a full-screen page with its own header, a detail page whose header
floats over the artwork, and a sheet (`formSheet` on iOS and Android, a plain
page in a browser). A sheet's page is one scroll view with its title as the
first, sticky row (`components/sheet.tsx`): an iOS form sheet stretches the
scroll view it finds over the whole sheet, and a title beside it ended up
under the content.

**Buttons over a picture** — ✕, "⋯", Cast — are the platform's own wherever
there is a native header to put them in (`components/header-button.tsx`):

- In a header on iOS 26 and later, the system draws its glass round each
  button, so `HeaderButton` draws only its symbol (`inHeader`); Android's
  Material toolbar takes them as they are.
- Anywhere else — no header, an older iOS — the same button is a dark
  translucent circle with a white symbol, legible over any picture.
- No glass library is added for the places a header cannot reach: what the
  system draws, it draws; the rest is the circle.

**A short choice** — a series' seasons on a phone — is the platform's own
menu: `@expo/ui`'s universal `Picker` with `appearance="menu"`, inside a
`Host` given the page's scheme and its words' colour. Never a screen built
from `@expo/ui`.

## Shared pieces

What more than one tab draws, in `src/components/`:

- **The overlay picker** (`overlay-picker.tsx`) — a list over the whole
  screen, for choosing one of many: categories, a row's category. Large grey rows, the chosen one bold in the page's own colour and
  scrolled to as it opens, and a round ✕ at the bottom; none on a TV, where
  Menu closes it. It is React Native's own modal, so it sits above a native
  sheet and takes a remote's focus.
- **A row's title** (`media/row-title.tsx`) — grey capitals, tracked: the
  theme's `$color10`, never a colour of its own.
- **Cast** (`cast-button.tsx`) is built — a header button, or a floating
  one — and drawn nowhere while `CASTING` is false: there is no casting yet.
- **A title's menu** (`media/title-menu.tsx`) — Play with…, Download and Add
  to list, each a page of choices; `initialPage` opens it on one of them, for
  a page that gives each its own button.
- **Boxed facts** (`media/badges.tsx`, `BoxBadge`) — an age rating filled,
  how a title looks and sounds ("4K", "Dolby Vision") outlined.
- **On a TV**: `snap-point.tsx` marks where a scroll view holds what has the
  focus, and `focus-group.tsx` says when the focus comes into a group and goes
  (`docs/platforms/tvos`).

## Four tabs

**Media, Videos, Live, Settings.** What appears on each is decided by category
and kind in `services/tab-content.ts` (`docs/adapters`), never by a plugin's
name.

- **Media** — a source's movies, shows and anime, merged across every
  source ([`media/`](media/README.md)).
- **Videos** — web video and files, one tab per source. A source that can
  narrow its search (`media.searchScopes`) puts the choice at the search box's
  left — All, Video, Channel, Playlist — and a channel among the videos is
  drawn round (`components/media/channel-card.tsx`), a playlist with how many
  videos it holds. A channel opens its own page (`screens/media/channel.tsx`):
  its banner and face, how many follow it, what it says about itself, Follow,
  and its sections — Videos, Shorts, Live, Playlists — as a grid that pages on
  as it scrolls. A playlist's page is its videos, in its order, and whose list
  it is; a video's page leads to its channel.
- **Live** — everything IPTV brings, in Live, Movies and Series sections, plus any
  source's `live` channels. Media and Videos never show IPTV content.
- **Settings** — the account, profiles, plugins, about.

Phase 6 gives Videos new icons, gives Live the TV ones, and makes the web's top
bar compact on narrow screens; today it wraps below about 400 px wide.

### One UI per tab, and per device

Each content tab is a UI of its own — its own design, its own components and
its own controls — in `src/tabs/<tab>/`, and so is each form factor within it:

```
src/tabs/
  media/   index.ts   shared/   mobile/   tv/
  videos/  index.ts   shared/   mobile/   tv/
  live/    index.ts   shared/   mobile/   tv/
```

- **`mobile/`** is a phone, a tablet and a browser; **`tv/`** a television and
  its remote. **`shared/`** is what both use — hooks, pure logic, and a screen
  that is the same on both.
- **A tab's `index.ts`** declares the screens its routes draw, and takes them
  from `tv` or `mobile` at runtime (`isTV`), so one bundle serves every device
  and each form factor must provide every screen. Routes import only
  `@/tabs/<tab>`.
- **Lint keeps them apart** (`import/no-restricted-paths` in
  `eslint.config.js`): a tab never imports another, `mobile` and `tv` never
  import each other, `shared` imports neither, and nothing outside `src/tabs`
  reaches in but the routes. What two tabs need belongs in `src/components`,
  `src/hooks` or `src/services`.
- **Videos and Live** draw one screen on both for now, which branches on
  `isTV` where a TV differs, until each gets a design of its own.

## Media

Its home, a title's sheet and page, search, the rows and how they are kept
are in [`media/`](media/README.md).

## Live

`tabs/live/shared/live.tsx`. With no IPTV connection it shows the way to add one (in a
browser, that providers can't be reached there). On a TV its header — the
providers, the sections, the search box — stands above the list rather than
scrolling with it, and its sides are the TV's gutter, clear of the tabs'
rail. On a TV, too, a section — Live, Movies, Series — and a group of
channels show as the remote rests on their chip, a quarter of a second, with
no select: moving along the chips moves through them, and a chip passed
quickly is not loaded (`SourceTabs`, `selectOnFocus`). Otherwise:

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
  (`live/channel/[connectionId]/[channelId]`): today from midnight, what is on
  now marked, and Watch live.
- **In the player**, a channel's group — or the ★ list it was played from —
  slides in from the left, over the picture, from the Channels button or a
  TV remote's left (`docs/playback`). A row there is the Live tab's own, drawn
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
(`components/search-field.tsx`): Media's search page — every film, series and
anime, from the magnifier on its home — a Videos source, and each of Live's
sections.

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
  sources there that keep none: Media, Videos, Live's films and series. The
  account's, the same for every profile and device; a source that keeps its
  own — a media server — keeps it there.
- **App** — how this device behaves, whoever is watching. On a TV, where the
  list is read across a room, how it looks is a page of its own —
  Appearance, with the scheme and the buttons — and its row says both
  (`screens/settings/appearance.tsx`). Its Appearance —
  System, Light or Dark — the tab it opens on
  (Media, Videos or Live), whether it asks who's watching every time it starts
  (on by default on a TV, where whoever picks up the remote is someone else;
  the default profile is kept for when it is off), force landscape on
  playback, whether a title's buttons show their words beside their
  symbols, and **Buffering**: Off, Memory — the default — or Disk, where a
  player here can keep what it reads ahead on storage. Disk adds its limit:
  a slider on a phone, a step down and a step up on a TV, half a gigabyte to
  eight and no more than half of what is free; its row says what it is
  used for and names the players that keep it in memory instead
  (`screens/settings/buffering.tsx`, `docs/playback`).
  - **Home screen glow** — on a phone and in a browser, a wash of colour from
    the top of Media's home down into the page: half the tint on black, less
    on white, ending in the page's own colour (`components/glow.tsx`). On by
    default, in the accent, which follows light and dark.
  - **Glow colour** picks another (`screens/settings/glow.tsx`): a preview of
    the home, a wheel for hue and saturation, a slider for brightness, the
    accent and five deep presets, kept as `#rrggbb` once the finger lifts.
    Nothing on that page scrolls, so nothing can take a drag from the wheel.
    A TV has no glow, and neither row.
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
    up. It brings nothing to a tab: watch status the app keeps on Live is keyed
    by what it answers, so a provider's German and English copies of a film
    are one.
- **Credits** end every adapter's page (`settings/adapters/[category]/[name]`):
  what it is built on or talks to, from its manifest (`credits`), for this
  platform — Jellyfin, Yattee Server, mpv and its builds, VLC and VLCKit,
  Foyer and PocketBase — and a service's notice beneath, TMDB's among them.
  Each is a row that opens the address (`LinkRow`): GitHub's mark for a
  repository there and a globe for a site, chosen by the address; what it is
  and the address beneath; a link symbol at the far end. On a TV, which has no
  browser, the row shows the address and keeps the remote's focus, with no
  link symbol.
- **About** — the version, and Loge itself: free software under the GNU AGPL,
  a row of the same kind opening its source on GitHub. No screen names a
  service itself.

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

**Who's watching** (`screens/profile-picker/`) is one hook drawn two ways.
On a phone, a tablet and in a browser: the question at the top, with Cancel
and Edit — Settings → Profiles — beside it while the app runs, and the
profiles as square tiles, two to a row on a phone and more from `$md`, a lock
where a PIN is asked and the ring on the one in use; Add profile comes last
until the account is full, and opens a name field. On a TV: a photograph
across the screen, another every 20 to 45 seconds with its credit, and the
profiles down the left — the one the remote is on grown, ringed and named, a
pencil beside it while the app runs, + last (`docs/platforms/tvos`).

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
  a settings row lights up, a switch is an On/Off pill. A card's words sit
  clear of its lifted picture, and a row leaves room above it
  (`cardFocusRoom`), or the ring is drawn through the title and cut off at
  the row's edge.
- **Cards have TV sizes of their own** (`components/shelf.tsx`): posters 240
  points wide, about seven across, and scenes 400, about four. Grown with the
  type they were six and three, and a row was too tall for a screen.
- **The tabs run down the left**, under Loge's icon, a column of symbols
  while the remote is in a page — Media, Videos, Live, Settings, the one shown
  in the accent — that
  opens with their names, over the page on a veil, while it is in the rail.
  Select changes the tab and sends the remote into it, and the rail closes
  behind it. Left from a page's first control reaches the rail; right goes
  back to what the remote left.
- **Back on a tab's first screen walks outwards**: to the first of the row,
  list or column the remote is in, then to the rail, then out of the app.
- **No headers on tab roots or detail pages** — the rail names the tab, and
  Menu goes back — and sheets take the whole screen, as do who is watching
  and a profile's PIN, which are pushed (`profileGateOptions`).
- **A title's page keeps to its column**: the logo over the picture lines up
  with the year and the buttons beneath it, well inside the screen's edge.
- **Media's home and title page** are its own (`media/`): a top bar, rows
  whose focused title is drawn as a scene and held on the left, and a page
  whose Episodes and More like this slide in from the right.
- **The player** answers the remote: select brings the controls up with the
  focus on play/pause, the arrows move among them, and a panel takes the
  focus. With them away, a double press of left or right jumps as a double
  tap does; its scrubber is a progress bar (`docs/platforms/tvos`).
- **A channel is watched with the controls away**: a banner at the bottom —
  logo or number, name, now with its time, progress and description, and
  next — comes in as it opens or zaps and leaves after five seconds. Up and
  down zap, right brings the banner back, select the controls.
- **Back closes the layer on top**: the channel list, a panel, the controls,
  the banner, and then the player.

## On the web

`src/app/_layout.tsx` imports `@tamagui/core/reset.css`. Without it the
browser's own styles leak in — button padding alone squeezes every switch.

Tamagui 2.7.7 warns in development that an `AlertDialogContent` "requires a
description" even when it has one; its check runs before the dialog's portal
mounts. The dialog is correctly described — check `aria-describedby` in the DOM.
