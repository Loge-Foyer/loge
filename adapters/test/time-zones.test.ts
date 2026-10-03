import { COUNTRY_ZONES, countryOf, fromZoneWallClock, TIME_ZONES, zoneOffsetMs } from '@loge/api';
import { describe, expect, it } from 'vitest';

const HOUR = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe('time zones', () => {
  it('lists every zone by its IANA id, the ones people look for among them', () => {
    expect(TIME_ZONES).toContain('Europe/Berlin');
    expect(TIME_ZONES).toContain('Europe/Istanbul');
    expect(TIME_ZONES).toContain('UTC');
    expect(new Set(TIME_ZONES).size).toBe(TIME_ZONES.length);
    expect(TIME_ZONES.length).toBeGreaterThan(400);
  });

  it('knows how far a zone is ahead of UTC, summer time included', () => {
    expect(zoneOffsetMs('Europe/Berlin', at('2026-01-15T12:00:00Z'))).toBe(HOUR);
    expect(zoneOffsetMs('Europe/Berlin', at('2026-07-01T12:00:00Z'))).toBe(2 * HOUR);
    expect(zoneOffsetMs('Europe/Istanbul', at('2026-01-15T12:00:00Z'))).toBe(3 * HOUR);
    expect(zoneOffsetMs('America/New_York', at('2026-07-01T12:00:00Z'))).toBe(-4 * HOUR);
    expect(zoneOffsetMs('Asia/Kolkata', at('2026-07-01T12:00:00Z'))).toBe(5.5 * HOUR);
    expect(zoneOffsetMs('UTC', at('2026-07-01T00:00:00.500Z'))).toBe(0);
    expect(zoneOffsetMs('Mars/Olympus_Mons', at('2026-07-01T12:00:00Z'))).toBeUndefined();
  });

  it('turns a wall-clock time stamped as UTC into the instant it is', () => {
    // 20:15 in Berlin, sent as 20:15Z: 18:15Z in summer, 19:15Z in winter.
    expect(new Date(fromZoneWallClock(at('2026-07-01T20:15:00Z'), 'Europe/Berlin')).toISOString()).toBe('2026-07-01T18:15:00.000Z');
    expect(new Date(fromZoneWallClock(at('2026-01-15T20:15:00Z'), 'Europe/Berlin')).toISOString()).toBe('2026-01-15T19:15:00.000Z');
    expect(new Date(fromZoneWallClock(at('2026-01-15T20:15:00Z'), 'Europe/Istanbul')).toISOString()).toBe('2026-01-15T17:15:00.000Z');
    // A zone this platform does not know changes nothing.
    expect(fromZoneWallClock(at('2026-01-15T20:15:00Z'), 'Mars/Olympus_Mons')).toBe(at('2026-01-15T20:15:00Z'));
  });

  it('lands right on the night summer time begins and ends', () => {
    // Berlin moves from 02:00 to 03:00 on 29 March 2026, and back on 25 October.
    expect(new Date(fromZoneWallClock(at('2026-03-29T01:30:00Z'), 'Europe/Berlin')).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(new Date(fromZoneWallClock(at('2026-03-29T03:30:00Z'), 'Europe/Berlin')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(new Date(fromZoneWallClock(at('2026-10-25T04:30:00Z'), 'Europe/Berlin')).toISOString()).toBe('2026-10-25T03:30:00.000Z');
    expect(new Date(fromZoneWallClock(at('2026-10-24T22:00:00Z'), 'Europe/Berlin')).toISOString()).toBe('2026-10-24T20:00:00.000Z');
  });
});

describe('countries', () => {
  it('gives every country one zone the platform knows, by the spelling the list uses', () => {
    expect(Object.keys(COUNTRY_ZONES).length).toBeGreaterThan(240);
    for (const [country, zone] of Object.entries(COUNTRY_ZONES)) {
      expect(country).toMatch(/^[A-Z]{2}$/);
      expect(TIME_ZONES).toContain(zone);
      expect(zoneOffsetMs(zone, at('2026-07-01T12:00:00Z'))).toBeTypeOf('number');
    }
    expect(COUNTRY_ZONES.DE).toBe('Europe/Berlin');
    expect(COUNTRY_ZONES.TR).toBe('Europe/Istanbul');
    expect(COUNTRY_ZONES.US).toBe('America/New_York');
    expect(COUNTRY_ZONES.RU).toBe('Europe/Moscow');
    expect(COUNTRY_ZONES.UA).toBe('Europe/Kiev');
  });

  it('reads a country off a guide id first, the way XMLTV sources end them', () => {
    expect(countryOf({ guideId: 'trt1.tr', names: ['DE ✨ DEUTSCHLAND'] })).toBe('TR');
    expect(countryOf({ guideId: 'ard.de', names: [] })).toBe('DE');
    expect(countryOf({ guideId: 'DasErste.de@HD', names: [] })).toBe('DE');
    expect(countryOf({ guideId: 'BBCOne.uk', names: [] })).toBe('GB');
    expect(countryOf({ guideId: 'TRT 1 HD', names: [] })).toBeUndefined();
  });

  it('reads one off a name that starts with a code, a flag or a country', () => {
    expect(countryOf({ names: ['TR ✨ ULUSAL'] })).toBe('TR');
    expect(countryOf({ names: ['|DE| SPORT'] })).toBe('DE');
    expect(countryOf({ names: ['[TR] SPOR'] })).toBe('TR');
    expect(countryOf({ names: ['DE: KIDS'] })).toBe('DE');
    expect(countryOf({ names: ['KKTC ✨ KIBRIS'] })).toBe('CY');
    expect(countryOf({ names: ['🇹🇷 ULUSAL'] })).toBe('TR');
    expect(countryOf({ names: ['TÜRKİYE'] })).toBe('TR');
    expect(countryOf({ names: ['Deutschland HD'] })).toBe('DE');
    expect(countryOf({ names: ['AR ✨ SAUDI ARABIA'] })).toBe('SA');
    // The group comes before the channel's own name.
    expect(countryOf({ names: [undefined, 'UK: BBC One'] })).toBe('GB');
  });

  it('takes nothing for a country that is a language, a channel, or a word', () => {
    expect(countryOf({ names: ['AR ✨ MBC'] })).toBeUndefined();
    expect(countryOf({ names: ['TV 8 FHD'] })).toBeUndefined();
    expect(countryOf({ names: ['FHD ✨ SPORT'] })).toBeUndefined();
    expect(countryOf({ names: ['De Wereld'] })).toBeUndefined();
    expect(countryOf({ names: ['↺DAS ERSTE FHD'] })).toBeUndefined();
    expect(countryOf({ names: ['EX-YU ✨ FILM'] })).toBeUndefined();
    expect(countryOf({ names: [] })).toBeUndefined();
  });
});
