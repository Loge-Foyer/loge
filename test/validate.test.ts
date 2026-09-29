import { isKdfParams, KDF_LIMITS, pluginId, validateManifest, type PluginManifest } from '@sc/api';
import { describe, expect, it } from 'vitest';

const sound: PluginManifest = {
  id: pluginId('fixture'),
  displayName: 'Fixture',
  description: 'A plugin that exists only in tests.',
  media: { contentKinds: ['videos'], capabilities: ['browse'] },
  sync: { capabilities: ['profile', 'watchProgress'] },
  connectionFields: [
    { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  settings: [
    { key: 'syncWatchProgress', label: 'Progress', type: 'boolean', default: false, gates: ['sync.watchProgress'] },
  ],
};

function problemsWith(overrides: Partial<PluginManifest>): readonly string[] {
  return validateManifest({ ...sound, ...overrides });
}

describe('validateManifest', () => {
  it('accepts a sound manifest', () => {
    expect(validateManifest(sound)).toEqual([]);
  });

  it('rejects a manifest with no role', () => {
    const { media: _media, sync: _sync, ...roleless } = sound;
    expect(validateManifest({ ...roleless, settings: [] })).toContain('declares no role');
  });

  it('rejects a media role that brings nothing', () => {
    expect(problemsWith({ media: { contentKinds: [], capabilities: [] } })).toContain(
      'media role brings no content kind',
    );
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

  // Signing in to an account is the opt-in: it carries what it declares.
  it('accepts a sync capability without a toggle', () => {
    expect(problemsWith({ settings: [] })).toEqual([]);
  });

  it('accepts a sync toggle that defaults to on', () => {
    const problems = problemsWith({
      settings: [
        { key: 'syncWatchProgress', label: 'Progress', type: 'boolean', default: true, gates: ['sync.watchProgress'] },
      ],
    });
    expect(problems).toEqual([]);
  });

  it('rejects a per-profile sync capability without profiles', () => {
    for (const capability of ['preferences', 'watchProgress', 'favorites', 'watchlist', 'history', 'customLists'] as const) {
      expect(problemsWith({ sync: { capabilities: [capability] }, settings: [] })).toContain(
        `sync capability "${capability}" needs "profile"`,
      );
    }
    expect(problemsWith({ sync: { capabilities: ['providerConnections'] }, settings: [] })).toEqual([]);
  });

  it('rejects a gate on an undeclared capability', () => {
    const problems = problemsWith({
      settings: [
        ...sound.settings,
        { key: 'showLive', label: 'Live', type: 'boolean', default: true, gates: ['media.live'] },
      ],
    });
    expect(problems).toContain('setting "showLive" gates undeclared "media.live"');
  });

  it('rejects a toggle that gates two roles', () => {
    const problems = problemsWith({
      settings: [
        {
          key: 'syncEverything',
          label: 'Everything',
          type: 'boolean',
          default: false,
          gates: ['sync.watchProgress', 'media.browse'],
        },
      ],
    });
    expect(problems).toContain('setting "syncEverything" gates more than one role');
  });
});

describe('validateManifest — libraries and credentials', () => {
  const libraries = { key: 'libraries', label: 'Libraries', type: 'libraries', default: { mode: 'all' } } as const;
  const withLibrariesCapability = { contentKinds: ['movies'], capabilities: ['browse', 'libraries'] } as const;

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
  const account = (sync: NonNullable<PluginManifest['sync']>) => problemsWith({ sync, settings: [] });

  it('accepts an owner proof that names password fields', () => {
    expect(account({ capabilities: ['profile'], ownerProof: { fields: ['password'] } })).toEqual([]);
  });

  it('rejects an owner proof that names no field, or a field that is not a password', () => {
    expect(account({ capabilities: ['profile'], ownerProof: { fields: [] } })).toContain('ownerProof names no field');
    expect(account({ capabilities: ['profile'], ownerProof: { fields: ['serverUrl'] } })).toContain(
      'ownerProof field "serverUrl" is not a password connection field',
    );
  });

  it('accepts sign-up fields beside the connection’s own', () => {
    expect(account({ capabilities: ['profile'], signUp: { fields: [{ key: 'invite', label: 'Invite', type: 'text' }] } })).toEqual([]);
  });

  it('rejects a sign-up field that is a password, clashes, repeats or is badly named', () => {
    const problems = account({
      capabilities: ['profile'],
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

  it('rejects sealed passwords without the connections they travel in', () => {
    expect(account({ capabilities: ['profile', 'sealedPasswords'] })).toContain(
      'sync capability "sealedPasswords" needs "providerConnections"',
    );
    expect(account({ capabilities: ['profile', 'providerConnections', 'sealedPasswords'] })).toEqual([]);
  });
});

describe('isKdfParams', () => {
  const params = { algorithm: 'pbkdf2-sha256', iterations: 600_000, salt: new Uint8Array(16) } as const;

  it('accepts PBKDF2 within the limits', () => {
    expect(isKdfParams(params)).toBe(true);
    expect(isKdfParams({ ...params, iterations: KDF_LIMITS.minIterations })).toBe(true);
    expect(isKdfParams({ ...params, iterations: KDF_LIMITS.maxIterations, salt: new Uint8Array(64) })).toBe(true);
  });

  // A server — or anyone between it and the device — asking for less would get a proof cheap to guess from.
  it('refuses anything weaker, heavier, or not what the device derives', () => {
    for (const bad of [
      { ...params, iterations: KDF_LIMITS.minIterations - 1 },
      { ...params, iterations: 1 },
      { ...params, iterations: KDF_LIMITS.maxIterations + 1 },
      { ...params, iterations: 600_000.5 },
      { ...params, iterations: '600000' },
      { ...params, salt: new Uint8Array(8) },
      { ...params, salt: new Uint8Array(65) },
      { ...params, salt: 'c2FsdA' },
      { ...params, algorithm: 'scrypt' },
      null,
    ]) {
      expect(isKdfParams(bad), JSON.stringify(bad)).toBe(false);
    }
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
    expect(validateManifest({ ...blockless, id: pluginId('sync/drive'), category: 'sync', backup: { location: 'Drive → Streaming Center' } })).toEqual([]);
  });

  it('needs the id to be the category and a name', () => {
    expect(with_(source, { id: pluginId('fixture') })).toContain('id "fixture" must be "sources/<kebab-case name>"');
    expect(with_(source, { id: pluginId('iptv/fixture') })).toContain('id "iptv/fixture" must be "sources/<kebab-case name>"');
    expect(with_(source, { category: 'widgets' as never })).toContain('category "widgets" is not one of sources, iptv, players, sync');
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

  it('checks an account block as the sync block was', () => {
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
