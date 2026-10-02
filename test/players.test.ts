import { pluginId, type Plugin } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { ENGINES, type Engine } from './support/engines';
import { buildServices } from './support/services';

function player(id: string, displayName: string, platforms: Plugin['manifest']['platforms']): Plugin {
  return {
    manifest: {
      id: pluginId(`players/${id}`),
      category: 'players',
      platforms,
      displayName,
      description: `The ${displayName}.`,
      player: { profiles: {} },
      connectionFields: [],
      settings: [],
    },
  };
}

const HLS = { protocols: ['hls'], containers: [], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [] } as const;

const builtIn = player('built-in', 'Built-in player', ['ios', 'android', 'web']);
const phoneOnly = player('phone-only', 'Phone player', ['ios', 'android']);
const iosOnly = player('ios-only', 'Zeta player', ['ios']);

describe.each(ENGINES)('players on %s', (engine: Engine) => {
  it('are every player on this platform, all on, the first playing first', async () => {
    const phone = buildServices({ plugins: [builtIn, phoneOnly, iosOnly], engine, platform: 'ios' });
    expect((await phone.services.players.list()).map((each) => [each.manifest.id, each.enabled, each.preferred])).toEqual([
      ['players/built-in', true, true],
      ['players/phone-only', true, false],
      ['players/ios-only', true, false],
    ]);
    const browser = buildServices({ plugins: [builtIn, phoneOnly, iosOnly], engine, platform: 'web' });
    expect((await browser.services.players.list()).map((each) => each.manifest.id)).toEqual(['players/built-in']);
  });

  it('start a new device on its defaults — an order and a first on each tab — until it chooses for itself', async () => {
    const plays = (plugin: Plugin): Plugin => ({
      ...plugin,
      manifest: { ...plugin.manifest, player: { profiles: Object.fromEntries((plugin.manifest.platforms ?? []).map((platform) => [platform, HLS])) } },
    });
    const [system, first, second] = [plays(builtIn), plays(phoneOnly), plays(iosOnly)];
    const playerDefaults = {
      order: [first.manifest.id, second.manifest.id, system.manifest.id],
      tabs: { media: first.manifest.id, tv: second.manifest.id },
    };
    const { services } = buildServices({ plugins: [system, first, second], engine, platform: 'ios', playerDefaults });
    const standing = async () => (await services.players.list()).map((each) => [each.manifest.id, each.preferred, each.firstOn]);
    expect(await standing()).toEqual([
      ['players/phone-only', true, ['media']],
      ['players/ios-only', false, ['tv']],
      ['players/built-in', false, []],
    ]);
    expect((await services.players.choosing('tv')).preferred).toBe(second.manifest.id);
    expect((await services.players.choosing('media')).preferred).toBe(first.manifest.id);
    // A tab with no first of its own takes the device's.
    expect((await services.players.choosing('videos')).preferred).toBe(first.manifest.id);

    // Taking one tab leaves the other's default where it was.
    await services.players.setFirstOn(system.manifest.id, 'media', true);
    expect(await standing()).toEqual([
      ['players/phone-only', true, []],
      ['players/ios-only', false, ['tv']],
      ['players/built-in', false, ['media']],
    ]);
    // An order of the device's own replaces the default one.
    await services.players.move(system.manifest.id, -1);
    expect((await services.players.list()).map((each) => each.manifest.id)).toEqual(['players/phone-only', 'players/built-in', 'players/ios-only']);

    // In a browser the defaults name players that are not there: the built-in one plays everything.
    const browser = buildServices({ plugins: [system, first, second], engine, platform: 'web', playerDefaults });
    expect((await browser.services.players.list()).map((each) => [each.manifest.id, each.preferred, each.firstOn])).toEqual([
      ['players/built-in', true, []],
    ]);
    expect((await browser.services.players.choosing('tv')).preferred).toBe(system.manifest.id);
  });

  it('keeps the controls the app’s: one row, in its own order, for every player', async () => {
    const phone = buildServices({ plugins: [builtIn, phoneOnly], engine, platform: 'ios' });
    const app = phone.services.appSettings;

    // What a player needs to hand, and no always-on Next episode.
    expect(await app.get()).toMatchObject({ seekMs: 10_000, buttons: ['audio', 'subtitles', 'speed'], forceLandscape: true });

    await app.setButton('buttons', 'chapters', true);
    // Put where the list itself has it, not on the end.
    expect((await app.get()).buttons).toEqual(['audio', 'subtitles', 'speed', 'chapters']);

    await app.setButton('buttons', 'audio', false);
    expect((await app.get()).buttons).toEqual(['subtitles', 'speed', 'chapters']);

    // Switched on again, it goes back where it was rather than to the end.
    await app.setButton('buttons', 'audio', true);
    expect((await app.get()).buttons).toEqual(['audio', 'subtitles', 'speed', 'chapters']);

    await app.set({ seekMs: 30_000 });
    expect((await app.get()).seekMs).toBe(30_000);
  });

  it('are reordered by moving one, favourite first, and the ends do nothing', async () => {
    const phone = buildServices({ plugins: [builtIn, phoneOnly, iosOnly], engine, platform: 'ios' });
    const order = async () => (await phone.services.players.list()).map((each) => each.manifest.id);
    const players = phone.services.players;

    await players.move(pluginId('players/ios-only'), -1);
    expect(await order()).toEqual(['players/built-in', 'players/ios-only', 'players/phone-only']);

    await players.move(pluginId('players/ios-only'), -1);
    expect(await order()).toEqual(['players/ios-only', 'players/built-in', 'players/phone-only']);
    // Nothing says otherwise, so the one on top is the one that plays first.
    expect((await players.list()).find((each) => each.preferred)?.manifest.id).toBe('players/ios-only');

    // Already at the top, and already at the bottom: both do nothing.
    await players.move(pluginId('players/ios-only'), -1);
    await players.move(pluginId('players/phone-only'), 1);
    expect(await order()).toEqual(['players/ios-only', 'players/built-in', 'players/phone-only']);
  });

  it('keep which are off and which plays first — switching one on to play first, and passing the turn when it goes off', async () => {
    const { services } = buildServices({ plugins: [builtIn, phoneOnly, iosOnly], engine, platform: 'ios' });
    await services.players.setEnabled(iosOnly.manifest.id, false);
    await services.players.setPreferred(iosOnly.manifest.id);
    expect((await services.players.list()).find((each) => each.manifest.id === iosOnly.manifest.id)).toMatchObject({ enabled: true, preferred: true });

    await services.players.setEnabled(iosOnly.manifest.id, false);
    const after = await services.players.list();
    expect(after.find((each) => each.manifest.id === iosOnly.manifest.id)).toMatchObject({ enabled: false, preferred: false });
    expect(after.find((each) => each.preferred)?.manifest.id).toBe(builtIn.manifest.id);
  });

  it('say which can play here, and which play first on a tab — none while it is off', async () => {
    const engine1 = { ...builtIn, manifest: { ...builtIn.manifest, player: { profiles: { ios: HLS } } } };
    const engine2 = { ...phoneOnly, manifest: { ...phoneOnly.manifest, player: { profiles: { ios: HLS } } } };
    const { services } = buildServices({ plugins: [engine1, engine2, iosOnly], engine, platform: 'ios' });
    await services.players.setFirstOn(engine2.manifest.id, 'tv', true);
    await services.players.setFirstOn(engine2.manifest.id, 'media', true);
    // Taking a tab from another player leaves it only the one it keeps.
    await services.players.setFirstOn(engine1.manifest.id, 'media', true);
    // Letting go of a tab it does not hold changes nothing.
    await services.players.setFirstOn(engine1.manifest.id, 'tv', false);
    const summary = (list: Awaited<ReturnType<typeof services.players.list>>) => list.map((each) => [each.manifest.id, each.playsHere, each.firstOn]);
    expect(summary(await services.players.list())).toEqual([
      ['players/built-in', true, ['media']],
      ['players/phone-only', true, ['tv']],
      ['players/ios-only', false, []],
    ]);
    await services.players.setEnabled(engine2.manifest.id, false);
    expect((await services.players.list())[1]?.firstOn).toEqual([]);
    await services.players.setFirstOn(engine1.manifest.id, 'media', false);
    expect((await services.players.list())[0]?.firstOn).toEqual([]);
  });

  it('are this device’s alone: nothing about them is journaled', async () => {
    const { services, db } = buildServices({ plugins: [builtIn, phoneOnly], engine, platform: 'android' });
    await services.account.createLocal('Lee');
    const before = (await db.journal.entries()).length;
    await services.players.setEnabled(phoneOnly.manifest.id, false);
    await services.players.setPreferred(phoneOnly.manifest.id);
    await services.players.setFirstOn(builtIn.manifest.id, 'tv', true);
    expect(await db.journal.entries()).toHaveLength(before);
    expect((await db.deviceSettings.get()).players).toEqual({ off: [], preferred: phoneOnly.manifest.id, tabs: { tv: builtIn.manifest.id } });
  });
});
