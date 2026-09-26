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
