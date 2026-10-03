import { creditsOn, pluginId, validateManifest, type PluginManifest } from '@loge/api';
import { describe, expect, it } from 'vitest';

const sound: PluginManifest = {
  id: pluginId('sources/fixture'),
  category: 'sources',
  platforms: ['ios', 'android', 'web'],
  displayName: 'Fixture',
  description: 'A plugin that exists only in tests.',
  media: { contentKinds: ['videos'], capabilities: ['browse', 'offlineMetadata'] },
  connectionFields: [
    { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  settings: [{ key: 'cacheMetadata', label: 'Keep', type: 'boolean', default: false, gates: ['media.offlineMetadata'] }],
};

function problemsWith(overrides: Partial<PluginManifest>): readonly string[] {
  return validateManifest({ ...sound, ...overrides });
}

describe('validateManifest', () => {
  it('accepts a sound manifest', () => {
    expect(validateManifest(sound)).toEqual([]);
  });

  it('rejects a manifest with no block', () => {
    const { media: _media, ...blockless } = sound;
    expect(validateManifest({ ...blockless, settings: [] })).toContain('declares no block');
  });

  it('rejects a media block that brings nothing', () => {
    expect(problemsWith({ media: { contentKinds: [], capabilities: [] } })).toContain('media role brings no content kind');
  });

  it('rejects duplicate keys within a list', () => {
    const problems = problemsWith({
      connectionFields: [
        { key: 'serverUrl', label: 'A', type: 'url' },
        { key: 'serverUrl', label: 'B', type: 'text' },
      ],
    });
    expect(problems).toContain('connection field key "serverUrl" is declared twice');
  });

  it('rejects a select whose default is not an option', () => {
    const problems = problemsWith({
      connectionFields: [
        { key: 'quality', label: 'Quality', type: 'select', default: 'best', options: [{ value: 'low', label: 'Low' }] },
      ],
    });
    expect(problems).toContain('select "quality" defaults to a missing option');
  });

  it('rejects a secret-looking field that is not a password field', () => {
    const problems = problemsWith({
      connectionFields: [{ key: 'apiToken', label: 'Token', type: 'text' }],
    });
    expect(problems).toContain('connection field "apiToken" looks secret but is not a password field');
  });

  it('takes search scopes only with search, and only known ones', () => {
    expect(problemsWith({ media: { contentKinds: ['videos'], capabilities: ['browse', 'search', 'offlineMetadata'], searchScopes: ['all', 'channel'] } })).toEqual([]);
    expect(problemsWith({ media: { contentKinds: ['videos'], capabilities: ['browse', 'offlineMetadata'], searchScopes: ['channel'] } })).toContain(
      'search scopes need the search capability',
    );
    expect(
      problemsWith({ media: { contentKinds: ['videos'], capabilities: ['browse', 'search', 'offlineMetadata'], searchScopes: ['channel', 'channel', 'shorts' as never] } }),
    ).toEqual(['search scope "shorts" is not one of all, video, channel, playlist', 'search scope "channel" is listed twice']);
  });

  it('rejects a gate on an undeclared capability', () => {
    const problems = problemsWith({
      settings: [...sound.settings, { key: 'showSearch', label: 'Search', type: 'boolean', default: true, gates: ['media.search'] }],
    });
    expect(problems).toContain('setting "showSearch" gates undeclared "media.search"');
  });
});

describe('validateManifest — libraries and credentials', () => {
  const libraries = { key: 'libraries', label: 'Libraries', type: 'libraries', default: { mode: 'all' } } as const;
  const withLibrariesCapability = { contentKinds: ['movies'], capabilities: ['browse', 'libraries', 'offlineMetadata'] } as const;

  it('accepts a libraries setting when the plugin can list its libraries', () => {
    expect(problemsWith({ media: withLibrariesCapability, settings: [...sound.settings, libraries] })).toEqual([]);
  });

  it('rejects a libraries setting without the libraries capability', () => {
    expect(problemsWith({ settings: [...sound.settings, libraries] })).toContain(
      'a libraries setting needs the media capability "libraries"',
    );
  });

  it('rejects two libraries settings', () => {
    const problems = problemsWith({
      media: withLibrariesCapability,
      settings: [...sound.settings, libraries, { ...libraries, key: 'moreLibraries' }],
    });
    expect(problems).toContain('declares more than one libraries setting');
  });

  it('rejects a libraries default that is not a selection', () => {
    const problems = problemsWith({
      media: withLibrariesCapability,
      settings: [...sound.settings, { ...libraries, default: { mode: 'only', ids: [42] } as never }],
    });
    expect(problems).toContain('libraries setting "libraries" has an invalid default');
  });

  it('rejects a setting marked as a credential', () => {
    const problems = problemsWith({
      settings: [...sound.settings, { key: 'accountName', label: 'Account', type: 'text', credential: true }],
    });
    expect(problems).toContain('setting "accountName" cannot be a credential; credentials are connection fields');
  });
});

describe('validateManifest — the account', () => {
  const { media: _media, ...blockless } = sound;
  const account = (block: NonNullable<PluginManifest['account']>) =>
    validateManifest({ ...blockless, id: pluginId('sync/fixture'), category: 'sync', account: block, settings: [] });

  it('accepts an owner proof that names password fields', () => {
    expect(account({ ownerProof: { fields: ['password'] } })).toEqual([]);
  });

  it('rejects an owner proof that names no field, or a field that is not a password', () => {
    expect(account({ ownerProof: { fields: [] } })).toContain('ownerProof names no field');
    expect(account({ ownerProof: { fields: ['serverUrl'] } })).toContain('ownerProof field "serverUrl" is not a password connection field');
  });

  it('accepts sign-up fields beside the connection’s own', () => {
    expect(account({ signUp: { fields: [{ key: 'invite', label: 'Invite', type: 'text' }] } })).toEqual([]);
  });

  it('rejects a sign-up field that is a password, clashes, repeats or is badly named', () => {
    const problems = account({
      signUp: {
        fields: [
          { key: 'secret', label: 'Secret', type: 'password' },
          { key: 'serverUrl', label: 'Again', type: 'url' },
          { key: 'invite', label: 'Invite', type: 'text' },
          { key: 'invite', label: 'Invite again', type: 'text' },
          { key: 'Bad-Key', label: 'Bad', type: 'text' },
          { key: 'plan', label: 'Plan', type: 'select', default: 'gold', options: [{ value: 'free', label: 'Free' }] },
        ],
      },
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'sign-up field "secret" cannot be a password field',
        'sign-up field "serverUrl" clashes with a connection field',
        'sign-up field key "invite" is declared twice',
        'sign-up field key "Bad-Key" must be camelCase',
        'select "plan" defaults to a missing option',
      ]),
    );
  });
});

describe('validateManifest — categories and platforms', () => {
  const source: PluginManifest = {
    id: pluginId('sources/fixture'),
    category: 'sources',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Fixture',
    description: 'A source that exists only in tests.',
    media: { contentKinds: ['movies'], capabilities: ['browse'] },
    connectionFields: [
      { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    settings: [],
  };
  const player: PluginManifest = {
    id: pluginId('players/fixture'),
    category: 'players',
    platforms: ['android'],
    displayName: 'Fixture player',
    description: 'A player that exists only in tests.',
    player: {
      profiles: {
        android: { protocols: ['progressive'], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [] },
      },
    },
    connectionFields: [],
    settings: [],
  };
  const with_ = (base: PluginManifest, overrides: Partial<PluginManifest>) => validateManifest({ ...base, ...overrides });

  it('accepts a plugin in each category with its one block', () => {
    expect(validateManifest(source)).toEqual([]);
    expect(validateManifest(player)).toEqual([]);
    expect(with_(source, { id: pluginId('iptv/fixture'), category: 'iptv' })).toEqual([]);
    const { media: _media, ...blockless } = source;
    expect(
      validateManifest({
        ...blockless,
        id: pluginId('sync/fixture'),
        category: 'sync',
        account: { ownerProof: { fields: ['password'] }, signUp: { fields: [{ key: 'invite', label: 'Invite', type: 'text' }] } },
      }),
    ).toEqual([]);
    expect(validateManifest({ ...blockless, id: pluginId('sync/drive'), category: 'sync', backup: { location: 'Drive → Loge' } })).toEqual([]);
  });

  it('needs the id to be the category and a name', () => {
    expect(with_(source, { id: pluginId('fixture') })).toContain('id "fixture" must be "sources/<kebab-case name>"');
    expect(with_(source, { id: pluginId('iptv/fixture') })).toContain('id "iptv/fixture" must be "sources/<kebab-case name>"');
    expect(with_(source, { category: 'widgets' as never })).toContain('category "widgets" is not one of sources, iptv, players, sync, metadata');
  });

  it('allows only the block the category declares, and only one', () => {
    expect(with_(source, { account: {} })).toEqual(
      expect.arrayContaining(['a sources plugin cannot declare the account block', 'declares media and account; a plugin declares one block']),
    );
    expect(with_(player, { media: { contentKinds: ['movies'], capabilities: [] } })).toContain('a players plugin cannot declare the media block');
  });

  it('checks the platforms', () => {
    expect(with_(source, { platforms: [] })).toContain('runs on no platform');
    expect(with_(source, { platforms: ['ios', 'tvos' as never] })).toContain('platform "tvos" is not one of ios, android, web');
    expect(with_(source, { platforms: ['ios', 'ios'] })).toContain('platform "ios" is listed twice');
  });

  it('checks a player profile against where it runs', () => {
    expect(
      with_(player, {
        player: {
          profiles: {
            android: { protocols: [], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [] },
            ios: { protocols: ['hls'], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [] },
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining(['player profile for "android" plays no protocol', 'player profile for "ios", which the plugin does not run on']),
    );
  });

  it('checks an account block’s owner proof and sign-up fields', () => {
    const { media: _media, ...blockless } = source;
    const problems = validateManifest({
      ...blockless,
      id: pluginId('sync/fixture'),
      category: 'sync',
      account: { ownerProof: { fields: ['serverUrl'] }, signUp: { fields: [{ key: 'secret', label: 'Secret', type: 'password' }] } },
    });
    expect(problems).toEqual(
      expect.arrayContaining(['ownerProof field "serverUrl" is not a password connection field', 'sign-up field "secret" cannot be a password field']),
    );
  });

  it('needs a backup target to say where it keeps the file', () => {
    const { media: _media, ...blockless } = source;
    expect(validateManifest({ ...blockless, id: pluginId('sync/drive'), category: 'sync', backup: { location: ' ' } })).toContain(
      'backup location is empty',
    );
  });
});

describe('validateManifest — metadata', () => {
  const { media: _media, ...blockless } = sound;
  const metadata = (overrides: Partial<PluginManifest> = {}) =>
    validateManifest({
      ...blockless,
      id: pluginId('metadata/fixture'),
      category: 'metadata',
      connectionFields: [{ key: 'apiKey', label: 'Key', type: 'password', required: true }],
      settings: [],
      metadata: { identifies: ['movies', 'shows'] },
      ...overrides,
    });

  it('accepts a metadata block that names films and series', () => {
    expect(metadata()).toEqual([]);
  });

  it('takes an attribution only with words in it', () => {
    expect(metadata({ attribution: 'Uses a catalogue.' })).toEqual([]);
    expect(metadata({ attribution: ' ' })).toContain('attribution is empty');
  });

  it('rejects one that names nothing, something it cannot, or one kind twice', () => {
    expect(metadata({ metadata: { identifies: [] } })).toContain('metadata role identifies nothing');
    expect(metadata({ metadata: { identifies: ['movies', 'movies', 'live' as never] } })).toEqual([
      'metadata kind "live" is not one of movies, shows',
      'metadata kind "movies" is listed twice',
    ]);
  });

  it('keeps the block in its category, and every other block out of it', () => {
    expect(validateManifest({ ...sound, metadata: { identifies: ['movies'] } })).toEqual(
      expect.arrayContaining(['a sources plugin cannot declare the metadata block', 'declares media and metadata; a plugin declares one block']),
    );
    expect(metadata({ media: { contentKinds: ['movies'], capabilities: [] } })).toContain('a metadata plugin cannot declare the media block');
  });
});

describe('validateManifest — credits', () => {
  const credit = { name: 'Upstream', url: 'https://github.com/example/upstream', note: 'What it is built on.' };

  it('accepts credits with an https address, a note, and platforms the plugin runs on', () => {
    expect(problemsWith({ credits: [credit, { name: 'Site', url: 'https://www.example.org', platforms: ['web'] }] })).toEqual([]);
  });

  it('refuses an address a browser should not be handed as it is', () => {
    for (const url of [
      'http://github.com/example/upstream',
      'https://user:secret@github.com/example',
      'https://github.com:443/example',
      'https://github.com/example?tab=readme',
      'https://github.com/example#readme',
      'javascript:alert(1)',
      'https://localhost/example',
      'https://127.0.0.1/example',
      'github.com/example/upstream',
      'https://github.com/example upstream',
      'https://GitHub.com/example',
      'https://github.com//example',
    ]) {
      expect(problemsWith({ credits: [{ ...credit, url }] }), url).toContain(`credit "Upstream" needs an https address, not "${url}"`);
    }
  });

  it('refuses an empty name or note, a platform it does not run on, and one listed twice', () => {
    expect(problemsWith({ credits: [{ ...credit, name: ' ' }] })).toContain('a credit has no name');
    expect(problemsWith({ credits: [{ ...credit, note: '' }] })).toContain('credit "Upstream" has an empty note');
    expect(problemsWith({ platforms: ['ios'], credits: [{ ...credit, platforms: ['web'] }] })).toContain(
      'credit "Upstream" names platform "web", which the plugin does not run on',
    );
    expect(problemsWith({ credits: [{ ...credit, platforms: [] }] })).toContain('credit "Upstream" names no platform');
    expect(problemsWith({ credits: [{ ...credit, platforms: ['ios', 'ios'] }] })).toContain('credit "Upstream" lists platform "ios" twice');
    expect(problemsWith({ credits: [credit, { ...credit, name: 'Again' }] })).toContain(`credit address "${credit.url}" is listed twice`);
  });

  it('gives each platform its own', () => {
    const credits = [credit, { name: 'Android build', url: 'https://github.com/example/android', platforms: ['android' as const] }];
    expect(creditsOn({ credits }, 'android').map((each) => each.name)).toEqual(['Upstream', 'Android build']);
    expect(creditsOn({ credits }, 'web').map((each) => each.name)).toEqual(['Upstream']);
    expect(creditsOn({}, 'ios')).toEqual([]);
  });
});
