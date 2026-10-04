# Media

Films, series and anime from every source, merged: the tab a household opens
most. Its screens are modelled on the
[Netflix UI 2024](https://www.figma.com/community/file/1348399379890177021/netflix-ui-2024?q_id=242a5470-91b1-46a0-bab2-d555e0ca9e42)
community file on Figma — the layout of the home, the title sheet and the TV
pages. What stayed Loge's own: no Netflix name, logo, red or rows. The rows
are the profile's, the colours the theme's, and the tab bar the platform's.

This page describes the target; `docs/ui` has the system it is built from.

## Where it lives

`src/tabs/media/`, in three parts (`docs/ui` says why):

- **`shared/`** — what both form factors use: the home's view model
  (`use-media-home.ts`), a title's data and actions (`title-data.ts`,
  `title-actions.ts`), pure helpers (`filter-chips.ts`, `hero.ts`,
  `title-meta.ts`, `links.ts`), and the screens that are the same on both —
  search, the row's grid, Customize.
- **`mobile/`** — a phone, a tablet and a browser.
- **`tv/`** — a television and its remote.

Routes: the home is `(tabs)/media`, search `(tabs)/media/search`, pushed
inside the tab so its bar stays; a title is `(app)/title/[connectionId]/[itemId]`
(`?season=` opens a series on one), a sheet on a phone and a page elsewhere;
a row's grid is `(app)/browse/[rowId]` (`?kind=&genre=` narrow it as the home
was). Links are `titleHref`, `titleKeyHref` and `browseHref`, never a path
spelled by hand. Videos, Live and the lists keep the ordinary page at
`(app)/item/…`.

## The rows

A profile's home is Continue Watching, then Downloaded, then its own rows,
in its own order — never rows of the service's choosing.

- **A row is kinds and a category**: Movies; Shows; "Comedy" — films and
  series side by side, newest first; "Comedy movies". Its title says so, in
  grey capitals (`rowTitle`, `RowTitle`). A row of several kinds asks each
  source once per kind and merges what comes back; a category row asks only
  sources whose `genres` capability is in effect (`docs/adapters`).
- **Customize** (`shared/customize.tsx`): per row, up and down, shown or
  hidden, its kinds — any of those the sources bring, at least one — its
  category (Any, or one from the overlay picker), sort and direction, posters
  or scenes. "Add a row" takes kinds and a category. Rows a profile adds can
  be removed; the default ones can only be hidden. Reset puts the defaults
  back. It is a sheet with everything inline, because a Tamagui portal would
  render behind a native one.
- **The layout travels with the profile**, and an app reads a version it
  does not know as no layout and shows its defaults rather than drawing a row
  it cannot:
  - **Version 2** brought the Downloaded row: this app adds it to a version 1
    layout, right after Continue Watching.
  - **Version 3** brought rows of several kinds and of one category. A layout
    is written as a 2 while every row is still one kind of every category
    (`layoutOf`), so a device on an older build keeps reading it until a row
    needs a 3. A kind's own row is known by its id, so one the profile has
    changed is never added again beside itself.
- **Downloaded** is this device's finished copies of the library — newest
  first, as scenes; a card opens the title, which opens with no network at
  all. It is hidden where nothing can be kept.
- **A row a source cannot fill is hidden**; a source that could not answer
  gets one line at the top, however many rows it would have filled; a profile
  that has not finished setting up a connection sees "Finish setting up".

**What was saved comes first.** At launch a row shows what its sources answered
last time — a placeholder, never taken for a fresh answer — until they answer
again. When one cannot, what was saved from it stays, and its line says how old
it is: "Home is only used on your home network. Showing what was saved 5 min
ago." The grid shows a saved first page the same way, and pages on only once
the source is back. All of this only where the source may be kept on the
device (`docs/data`).

## Narrowing the home

The chips over the home narrow every row at once (`services/home-filter.ts`,
`shared/filter-chips.ts`):

- Nothing chosen: Shows, Movies — Anime where a source brings it — and
  Categories ▾.
- A kind chosen: ✕, that kind alone, Categories ▾. Choosing it again clears it.
- A category chosen: ✕, the kinds, and the category's name where Categories
  was.
- Categories opens the overlay picker: All categories, then every genre the
  sources file their titles under, matched across sources by `genreKey`.
- A kind narrows Continue Watching and Downloaded to items of that type; a
  category, or Anime, hides them — an episode rarely carries genres, and an
  item does not carry its kind. The filter's own row comes first unless an
  equal row survived, so a narrowed home is never empty. A row's grid opened
  from a narrowed home is narrowed the same way.

## Cards

`components/media/`:

- *Poster* (2:3) — on the home, the picture alone; in a grid its title and
  year beneath. A check top right once watched, a bar along the bottom while
  partly watched — only where the source reports watch status to this
  profile. In the grid, the ratings stacked top left.
- *Landscape* (16:9) — Continue Watching, Downloaded, or any row switched to
  scenes: the frame where playback stopped when a source provides one, else
  the episode's still, else the backdrop; "S1 · E3 — Title" or "23 min left"
  below. In Continue Watching the picture, marked with a play glyph, resumes
  where it stopped, and the words open the title.

## Search

`shared/search.tsx`, from the magnifier in the home's header (a TV's top
bar): every film, series and anime the sources hold, as posters, at least
three across. It asks once typing pauses for two seconds, or at once on the
search key; only sources whose `search` is in effect are asked, and nothing of
a search is kept (`docs/ui`).

## On a phone, a tablet and in a browser

### The home

`mobile/home.tsx`, one scroll view:

- **The glow** behind the top of the page, in the profile's device's colour,
  fading out as the page scrolls (Settings → App, `docs/ui`). Not drawn when
  it is off.
- **The header** is the tab's native one, with no title: Loge's icon at its
  far left (`components/app-mark.tsx`), and at its right Search and the
  profile's square — and Cast, built and hidden — in the system's glass on
  iOS 26; the icon asks to stay out of it (`hidesSharedBackground`). It is
  see-through over the glow; below iOS 26 the bar blurs once the page runs
  under it, and Android's toolbar takes `$color3` then. The empty and
  set-up states keep the same header on the bar's own colour. A browser's
  top bar is its header, so there the page has a row of its own: the icon
  and Search.
- **The chips**, then any set-up callouts and source notices.
- **The hero**: the first film or series in the rows, in order, that is not
  watched and has a poster (`shared/hero.ts`) — its poster on a phone, a wide
  picture from `$md`, with its logo, its first three genres, and two
  buttons: Play — Resume where it stopped; a series plays the episode it is
  up to — in the accent, and Details, with the info symbol, which opens its
  sheet. The picture opens it too.
- **The rows**: each title in grey capitals with a chevron, opening its grid;
  posters with nothing beneath, which open the title's sheet.
- **At the foot**: Customize home, and Refresh in a browser, which cannot pull
  to refresh.

### A title's sheet

`mobile/title-sheet.tsx`. It rises to the top of the safe area and goes no
further, and closes on its ✕ or a slide down (`titleOptions`,
`components/stack-options.tsx`):

- **The page is one scroll view, with nothing round it and nothing beside
  it**, and every modal it opens — the title's menu — drawn inside it. An iOS
  form sheet gives a height only to a scroll view sitting straight in it — the
  whole sheet's, or less a header beside it — and leaves anything else none:
  a view round the scroll view came up blank. On Android the scroll view is
  `nestedScrollEnabled`, so what scrolls inside moves before the sheet does.
- **The ✕ on an iPhone** sits in the sheet's own native header, so iOS 26
  draws it in glass: an iOS form sheet shows a header only around a stack of
  its own, so `title/_layout.tsx` gives it one — and gives that stack the
  sheet's height by hand, the window's less the top of the safe area, since
  the sheet would give it none. A title opened from More like this is pushed
  inside it, with a back button; ✕ closes the whole sheet.
- **Elsewhere** — an iPad, whose sheet is a card of its own size; Android,
  whose form sheet cannot hold a nested stack; and the web — the ✕ floats in
  a sticky bar at the top of the scroll view, in `HeaderButton`'s dark
  circle, over the picture.
- **Top to bottom**: the picture, with how far it got; for an episode, its
  series and "S1 · E3", which open the series; the title; its score, years,
  age rating boxed, how long it runs or its seasons, and how it looks
  ("4K"); Play — or "Resume S2 · E3" — full width in the accent; Download,
  full width, where a copy can be kept, saying how far it has got; what it is
  about; "Cast:" and "Director:" (or "Creators:"), the cast cut short until
  "more"; a row of symbols — My list, Watched (the eye), Restart where it
  stopped part-way, Play with… where more than one player can, and File where
  the source says what the file is, opening `media-info`; then "Episodes" and
  "More like this" as tabs, the chosen one marked with the accent along its
  top.
- **Episodes**: the seasons are the platform's own menu — the season shown,
  and on a tap SwiftUI's menu with a check on it on iOS, Material's dropdown
  on Android, a select in a browser (`@expo/ui`'s `Picker`); a series of one
  season just names it. Each episode is its still with a play glyph — which plays it, from where it
  stopped — then its number and name and how long it runs, which open its own
  sheet, a symbol for its copy where one can be kept, and two lines of what
  it is about.
- **More like this**: titles of the same first genre and type, highest rated
  first (`useMoreLikeThis`), three posters across.

## On a TV

### The home

`tv/home.tsx`. The tabs are a rail down the left (`docs/ui`), so the top of
the page is Media's own:

- **The top bar** (`tv/top-bar.tsx`), one focus group: the profile's square
  with a chevron, Search, the chips, then Customize and Refresh.
- **The rows** (`tv/row.tsx`): a row's title is grey capitals the remote
  never lands on, and beneath its cards two lines about the one the remote
  is on — "S3 · E4 · Old Friends" and "20 min left", or the title, year and
  length and its genres. The lines keep their room when empty, so a row never
  changes height.
- **The card the remote is on is drawn as a scene** (`tv/card.tsx`): the
  backdrop, a still or the frame it stopped at, with the title's logo, as
  wide as 16:9 at the poster's height, while the cards after it are drawn
  that much further along. It fades in; the others slide.
- **The focused title is always on the left.** Right and left move the row,
  not the focus: the row snaps the focused card's slot to the margin, and
  keeps room after its last card for it to get there. Up and down snap the
  row the remote moves to near the top of the page, and hold still for the
  first row, so the top bar stays in view until the remote goes past it.
- **After twenty titles, More…** — a poster's outline with a plus — opens the
  row's grid.
- **Continue Watching**: select resumes; holding select opens the title.

### A title's page

`tv/title-page.tsx`, pushed, so the remote's focus reaches it. It is drawn
dark in either scheme — all of it sits on a picture:

- The backdrop across the screen, faded from the left and the bottom.
- Down the left: the logo, else the title; the score, years, first genre and
  length, with how it looks and sounds and its age rating boxed; three lines
  of what it is about; the cast and who made it.
- **Its actions**, a column, the one the remote is on a pill in the accent:
  Play or "Resume S1 · E3", where the focus starts; From the beginning, where
  it stopped part-way; Episodes, for a series — All episodes, for an episode;
  More like this; Mark as watched; More…, the title's menu.
- **Episodes and More like this slide in from the right** (`tv/side-panel.tsx`),
  about half the screen, on a dark veil. Up, down and right keep the remote
  in a panel; left goes back to the actions. Episodes has the seasons along
  its top — a season shows as soon as the remote is on its chip, with no
  select, so moving along the chips moves through the seasons — and each
  episode as its still, its number and name, how long it runs and two lines
  of what it is about; select plays it, and the focus starts on the one to
  watch next, until the remote has moved to another season. More like this is three posters across;
  select opens one's own page over this one.
- **Back closes the panel first**, and the focus goes back to what opened it;
  then the page (`useBackLayers`, `docs/platforms/tvos`).

### Where the focus starts

| Screen | Focus starts | Back / Menu |
| --- | --- | --- |
| Home | the first card of the first row with titles | the system's |
| Overlay picker | the chosen row | closes it |
| A title's page | Play or Resume | an open panel first, then the page |
| Episodes / More like this | the next episode / the first poster | closes the panel |
| Search | the field | the keyboard, then the page |
| A row's grid | the first card | the page |
