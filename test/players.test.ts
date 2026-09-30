import { pluginId, type Plugin } from '@sc/api';
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
