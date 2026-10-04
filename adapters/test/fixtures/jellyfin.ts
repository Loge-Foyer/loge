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
  // What `fields=MediaSources` adds: the file itself, with its streams inside.
  MediaSources: [
    {
      Id: 'source-4k',
      Name: '2160p HDR',
      Container: 'mkv',
      Size: 68_719_476_736,
      Bitrate: 72_000_000,
      RunTimeTicks: 70_980_000_000,
      MediaStreams: [
        {
          Index: 0,
          Type: 'Video',
          Codec: 'hevc',
          Width: 3840,
          Height: 2160,
          BitDepth: 10,
          BitRate: 68_000_000,
          AverageFrameRate: 23.976,
          Profile: 'Main 10',
          VideoRangeType: 'DOVIWithHDR10',
          IsDefault: true,
          IsForced: false,
        },
        {
          Index: 1,
          Type: 'Audio',
          Codec: 'truehd',
          Language: 'eng',
          DisplayTitle: 'English - TrueHD 7.1 - Atmos',
          Channels: 8,
          ChannelLayout: '7.1',
          BitRate: 4_200_000,
          AudioSpatialFormat: 'DolbyAtmos',
          IsDefault: true,
          IsForced: false,
        },
        {
          Index: 2,
          Type: 'Audio',
          Codec: 'eac3',
          Language: 'ger',
          DisplayTitle: 'German - Dolby Digital+ 5.1',
          Channels: 6,
          ChannelLayout: '5.1',
          AudioSpatialFormat: 'None',
          IsDefault: false,
          IsForced: false,
        },
        {
          Index: 3,
          Type: 'Subtitle',
          Codec: 'pgssub',
          Language: 'eng',
          DisplayTitle: 'English - PGS',
          IsDefault: false,
          IsForced: false,
          DeliveryMethod: 'Embed',
        },
        {
          Index: 4,
          Type: 'Subtitle',
          Codec: 'subrip',
          Language: 'ger',
          DisplayTitle: 'German - Forced',
          IsDefault: false,
          IsForced: true,
          IsExternal: true,
          DeliveryMethod: 'External',
        },
      ],
    },
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

/** A genre as `/Genres` lists it: an item of its own, of type Genre, trimmed to what is read. */
export function genre(name: string) {
  return { Name: name, ServerId: 'server-1', Id: `genre-${name.toLowerCase().replace(/\s+/g, '-')}`, Type: 'Genre', ImageTags: {}, BackdropImageTags: [], LocationType: 'FileSystem' };
}

export function page(items: readonly unknown[], total = items.length) {
  return { Items: items, TotalRecordCount: total, StartIndex: 0 };
}

// PlaybackInfo, shaped like Jellyfin 12.0's answers (recorded, then trimmed):
// an MP4 the player plays as it is, and an HDR Matroska it cannot.
export const directPlayInfo = {
  MediaSources: [
    {
      Protocol: 'File',
      Id: 'ms-arrival',
      Container: 'mov,mp4,m4a,3gp,3g2,mj2',
      ETag: 'etag-1',
      SupportsTranscoding: true,
      SupportsDirectStream: true,
      SupportsDirectPlay: true,
      RunTimeTicks: 69_600_000_000,
      DefaultAudioStreamIndex: 1,
      MediaStreams: [
        { Index: 0, Type: 'Video', Codec: 'h264', Height: 1080, Width: 1920, VideoRangeType: 'SDR', DisplayTitle: '1080p H264 SDR', IsDefault: true },
        { Index: 1, Type: 'Audio', Codec: 'aac', Language: 'eng', DisplayTitle: 'English - AAC - Stereo - Default', Channels: 2, IsDefault: true },
        { Index: 2, Type: 'Audio', Codec: 'ac3', Language: 'ger', DisplayTitle: 'German - Dolby Digital - 5.1', Channels: 6, IsDefault: false },
        { Index: 3, Type: 'Subtitle', Codec: 'mov_text', Language: 'eng', DisplayTitle: 'English - MOV_TEXT', IsDefault: false, IsForced: false, DeliveryMethod: 'Embed' },
      ],
    },
  ],
  PlaySessionId: 'play-1',
};

export const transcodeInfo = {
  MediaSources: [
    {
      Protocol: 'File',
      Id: 'ms-arrival',
      Container: 'mkv',
      SupportsTranscoding: true,
      SupportsDirectStream: false,
      SupportsDirectPlay: false,
      RunTimeTicks: 69_600_000_000,
      DefaultAudioStreamIndex: 1,
      DefaultSubtitleStreamIndex: 2,
      TranscodingUrl:
        '/videos/m-arrival/master.m3u8?DeviceId=device&MediaSourceId=ms-arrival&VideoCodec=h264&AudioCodec=aac&AudioStreamIndex=1&SubtitleStreamIndex=2&SegmentContainer=ts&PlaySessionId=play-2&ApiKey=token-1&SubtitleMethod=Hls',
      TranscodingSubProtocol: 'hls',
      TranscodingContainer: 'ts',
      MediaStreams: [
        { Index: 0, Type: 'Video', Codec: 'hevc', Height: 2160, VideoRangeType: 'HDR10', IsDefault: true },
        { Index: 1, Type: 'Audio', Codec: 'eac3', Language: 'tur', DisplayTitle: 'Turkish - Dolby Digital+ - 5.1 - Default', Channels: 6, IsDefault: true },
        { Index: 2, Type: 'Subtitle', Codec: 'subrip', Language: 'tur', DisplayTitle: 'Forced - Turkish - Default - SUBRIP', IsDefault: true, IsForced: true, DeliveryMethod: 'Hls' },
        { Index: 3, Type: 'Subtitle', Codec: 'PGSSUB', Language: 'eng', DisplayTitle: 'English - PGSSUB', IsDefault: false, IsForced: false, DeliveryMethod: 'Encode' },
        { Index: 4, Type: 'Subtitle', Codec: 'webvtt', Language: 'fre', DisplayTitle: 'French - WEBVTT', IsDefault: false, IsForced: false, DeliveryMethod: 'External', DeliveryUrl: '/Videos/m-arrival/ms-arrival/Subtitles/4/0/Stream.vtt' },
      ],
    },
  ],
  PlaySessionId: 'play-2',
};

export const noStreamInfo = { MediaSources: [], ErrorCode: 'NoCompatibleStream' };
