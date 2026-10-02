import { fromZoneWallClock, TIME_ZONES, zoneOffsetMs } from '@sc/api';
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
