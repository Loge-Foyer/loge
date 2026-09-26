/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Plugins run on Hermes in the iOS and Android apps, and Hermes lacks a few
// built-ins that Node and browsers have. Code using them typechecks and passes
// here, then throws on a phone — so the source is checked instead.
const MISSING_ON_HERMES: readonly { readonly pattern: RegExp; readonly instead: string }[] = [
  { pattern: /\.toSorted\(/, instead: 'copy, then sort' },
  { pattern: /\bObject\.groupBy\(/, instead: 'a loop into a Map' },
  { pattern: /\bcrypto\.randomUUID\(/, instead: 'an id from the context' },
];

const sources = import.meta.glob<string>(['../api/src/**/*.ts', '../plugins/*/src/**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('code that runs on phones', () => {
  it('finds the source files it checks', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it('uses no built-in that Hermes lacks', () => {
    const found: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const { pattern, instead } of MISSING_ON_HERMES) {
        if (pattern.test(text)) found.push(`${file}: ${pattern.source} — use ${instead}`);
      }
    }
    expect(found).toEqual([]);
  });
});
