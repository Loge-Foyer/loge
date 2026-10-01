/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Plugins run on Hermes in the iOS and Android apps, and Hermes lacks a few
// built-ins that Node and browsers have. Code using them typechecks and passes
// here, then throws on a phone — so the source is checked instead.
const MISSING_ON_HERMES: readonly { readonly pattern: RegExp; readonly instead: string }[] = [
  { pattern: /\.toSorted\(/, instead: 'copy, then sort' },
  { pattern: /\bObject\.groupBy\(/, instead: 'a loop into a Map' },
  { pattern: /\bcrypto\.randomUUID\(/, instead: 'an id from the context' },
  // Typed by esnext, missing on Hermes and on Node 24 alike.
  { pattern: /\.toBase64\(/, instead: 'encodeBase64 or encodeBase64Url from @sc/api' },
  { pattern: /\bfromBase64\(/, instead: 'decodeBase64Url from @sc/api' },
];

const sources = import.meta.glob<string>(['../api/src/**/*.ts', '../player-kit/src/**/*.{ts,tsx}', '../*/*/src/**/*.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('code that runs on phones', () => {
  it('finds the source files it checks', () => {
    const files = Object.keys(sources);
    expect(files.filter((file) => file.startsWith('../api/')).length).toBeGreaterThan(10);
    // A glob that stops matching after the folders move would check nothing, and pass.
    expect(files.some((file) => file.startsWith('../sources/jellyfin/src/'))).toBe(true);
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
