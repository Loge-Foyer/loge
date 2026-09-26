// Minimal payloads in the shape Jellyfin 12.x sends: PascalCase, nulls left
// out, ids as 32 hex digits in real life (short here for readability).

export const publicInfo = {
  LocalAddress: 'http://172.18.0.5:8096',
  ServerName: 'Home server',
  Version: '12.0.0',
  ProductName: 'Jellyfin Server',
  OperatingSystem: '',
  Id: 'e122352405504e089fa8fbc5b8dc9e8b',
  StartupWizardCompleted: true,
};

export const authentication = {
  User: { Id: 'user-1', Name: 'alex' },
  SessionInfo: { Id: 'session-1' },
  AccessToken: 'token-1',
  ServerId: 'e122352405504e089fa8fbc5b8dc9e8b',
};

export const me = { Id: 'user-1', Name: 'alex' };

export const views = {
  Items: [
    { Id: 'lib-movies', Name: 'Films', Type: 'CollectionFolder', CollectionType: 'movies' },
    { Id: 'lib-shows', Name: 'Series', Type: 'CollectionFolder', CollectionType: 'tvshows' },
    { Id: 'lib-mixed', Name: 'Family', Type: 'CollectionFolder' },
    { Id: 'lib-music', Name: 'Music', Type: 'CollectionFolder', CollectionType: 'music' },
  ],
  TotalRecordCount: 4,
  StartIndex: 0,
};

export const movie = {
  Id: 'm-arrival',
  Name: 'Arrival',
  SortName: 'arrival',
  Type: 'Movie',
  ProductionYear: 2016,
  PremiereDate: '2016-11-10T00:00:00.0000000Z',
  DateCreated: '2024-03-01T10:20:30.1234567Z',
  RunTimeTicks: 69_600_000_000,
  OfficialRating: 'PG-13',
  CommunityRating: 7.93,
  CriticRating: 94,
  ImageTags: { Primary: 'poster-tag', Logo: 'logo-tag', Thumb: 'thumb-tag' },
  BackdropImageTags: ['backdrop-tag'],
  ImageBlurHashes: { Primary: { 'poster-tag': 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' } },
  UserData: {
    Played: false,
    PlaybackPositionTicks: 34_800_000_000,
    PlayedPercentage: 50,
    PlayCount: 0,
    IsFavorite: true,
    LastPlayedDate: '2026-09-20T20:00:00.0000000Z',
  },
};

export const movieDetail = {
  ...movie,
  Overview: 'A linguist is recruited when mysterious spacecraft land around the world.',
  Genres: ['Drama', 'Science Fiction'],
  Taglines: ['Why are they here?'],
  Studios: [{ Name: 'Paramount', Id: 'studio-1' }],
  ProviderIds: { Imdb: 'tt2543164', Tmdb: '329865' },
  People: [
    { Name: 'Amy Adams', Id: 'person-1', Role: 'Louise Banks', Type: 'Actor', PrimaryImageTag: 'amy-tag' },
    { Name: 'Denis Villeneuve', Id: 'person-2', Type: 'Director' },
    { Name: 'Someone', Id: 'person-3', Type: 'Composer' },
  ],
};

export const unratedMovie = {
  Id: 'm-unrated',
  Name: 'Home Movie',
  Type: 'Movie',
  CommunityRating: 0,
  UserData: { Played: true, PlaybackPositionTicks: 0, PlayCount: 1, IsFavorite: false },
};

export const series = {
  Id: 's-severance',
  Name: 'Severance',
  Type: 'Series',
  ProductionYear: 2022,
  PremiereDate: '2022-02-18T00:00:00.0000000Z',
  Status: 'Continuing',
  ChildCount: 2,
  RecursiveItemCount: 20,
  CommunityRating: 8.7,
  ImageTags: { Primary: 'series-poster' },
  BackdropImageTags: ['series-backdrop'],
  UserData: {
    Played: false,
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    UnplayedItemCount: 12,
    PlayedPercentage: 33.333333,
  },
};

export const season = {
  Id: 'se-1',
  Name: 'Season 1',
  Type: 'Season',
  IndexNumber: 1,
  SeriesId: 's-severance',
  SeriesName: 'Severance',
  SeriesPrimaryImageTag: 'series-poster',
  ChildCount: 9,
  ImageTags: { Primary: 'season-poster' },
  UserData: { Played: true, PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, UnplayedItemCount: 0 },
};

export const episode = {
  Id: 'ep-1',
  Name: 'Good News About Hell',
  Type: 'Episode',
  IndexNumber: 1,
  ParentIndexNumber: 1,
  SeriesId: 's-severance',
  SeriesName: 'Severance',
  SeasonId: 'se-1',
  SeriesPrimaryImageTag: 'series-poster',
  PremiereDate: '2022-02-18T00:00:00.0000000Z',
  RunTimeTicks: 34_200_000_000,
  ImageTags: { Primary: 'episode-still' },
  ParentBackdropItemId: 's-severance',
  ParentBackdropImageTags: ['series-backdrop'],
  ParentLogoItemId: 's-severance',
  ParentLogoImageTag: 'series-logo',
  UserData: {
    Played: false,
    PlaybackPositionTicks: 17_100_000_000,
    PlayedPercentage: 50,
    PlayCount: 0,
    IsFavorite: false,
    LastPlayedDate: '2026-09-25T21:00:00.0000000Z',
  },
};

/** A film released in `year`, for paging and merging tests. */
export function film(id: string, year: number) {
  return {
    Id: id,
    Name: id,
    SortName: id,
    Type: 'Movie',
    ProductionYear: year,
    PremiereDate: `${year}-06-01T00:00:00.0000000Z`,
    UserData: { Played: false, PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false },
  };
}

export function page(items: readonly unknown[], total = items.length) {
  return { Items: items, TotalRecordCount: total, StartIndex: 0 };
}
