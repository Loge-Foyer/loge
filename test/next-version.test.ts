import { describe, expect, it } from 'vitest';

import { nextVersion } from '../scripts/next-version.mjs';

const at = (year: number, month: number) => new Date(year, month - 1, 15);

describe('the next version', () => {
  it('counts the build on within a month', () => {
    expect(nextVersion('2026.10.1', at(2026, 10))).toBe('2026.10.2');
  });

  it('takes the month and the year of the release, and never starts the build again', () => {
    expect(nextVersion('2026.10.7', at(2026, 11))).toBe('2026.11.8');
    expect(nextVersion('2026.12.9', at(2027, 1))).toBe('2027.1.10');
    expect(nextVersion('2026.10.1', at(2027, 3))).toBe('2027.3.2');
  });

  it('refuses a clock behind the last release', () => {
    expect(() => nextVersion('2026.10.5', at(2026, 9))).toThrow('before 2026.10.5');
  });

  it('refuses what is not YEAR.MONTH.BUILD', () => {
    for (const version of ['1.0.0', '2027.03.4', '2026.13.1', '2026.10.0', '2026.10']) {
      expect(() => nextVersion(version, at(2027, 3))).toThrow('YEAR.MONTH.BUILD');
    }
  });
});
