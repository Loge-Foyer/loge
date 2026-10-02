# TMDB

Which film or series a title is, from [The Movie Database](https://www.themoviedb.org),
for a source that does not say — so watch status the app keeps covers every
copy of a film, whatever language a provider keeps it in.

## Category

**Metadata** — `metadata/tmdb`, in `adapters/metadata/tmdb`. Its connections
belong to the account, like a source's: set up once, on every device of it,
and on your own server with the account's other keys. Each can be switched
off without being removed.

## What it talks to

TMDB's API, version 3, at `api.themoviedb.org` — read-only, with the
household's own key. Nothing is ever written to TMDB, and no TMDB account is
signed in to.

## Brings

Nothing to any tab. It answers one question for the app: *what is this?* —
films and series (`identifies: ['movies', 'shows']`), as their TMDB ids.

## Connection

- **API key or Read Access Token** — required, a password: the credential
  store on a device, never a row. Either of the two TMDB hands out on
  themoviedb.org → Settings → API works. A Read Access Token — a JWT, with
  dots in it — goes as `Authorization: Bearer`; an API key goes as `api_key`
  in the query, which the host's HTTP client never logs.

There is no session: every request carries the key.

## What it does

- **`check()`** asks `/authentication`, which answers only to a valid key.
- **`identify({ type, title, originalTitle?, year? })`** searches
  `/search/movie` or `/search/tv` — which match a title in any language TMDB
  knows it by — the original title first, and answers `{ tmdb }`, or nothing.
  - **Within a year either side.** A film comes out a year apart in two
    countries, and a portal writes whichever it saw. With a year, the search
    asks for that year first, and for any year when it finds none.
  - **Called by the name asked for**, as a title or an original title — no
    case, accents or punctuation.
  - **Else in another language:** where no result is called by it, the best
    two of the year are asked for their translations and alternative titles
    (`append_to_response`), and one is taken only if they include it.
  - **Several films of one name, and no year, are none.** A wrong answer is
    worse than none: it would merge one film's watch status into another's.

The app asks only about films and series of IPTV providers whose watch status
it keeps, that carry no catalogue id of their own, four at a time; it
remembers each answer, and a miss for thirty days.

## Errors

- **`401`** is `UNAUTHORIZED` and latched: the provider asks nothing more
  with that key, and the app waits for the user to change it.
- **`429`** is `PROVIDER_UNAVAILABLE` with `backoff` and `too-many-attempts`
  — TMDB counts requests per address, around fifty a second — and the app
  pauses its lookups.
- **`404`**, a title gone between a search and its names, is `NOT_FOUND`.

## Attribution

> This product uses the TMDB API but is not endorsed or certified by TMDB.

TMDB's terms ask an app using its API to say so where it lists its sources;
the app's Settings → About does.

## Status

Written and tested against recorded answers (`test/tmdb.test.ts`), and tried
against TMDB itself with a real key.
