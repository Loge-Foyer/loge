import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// `.mjs` keeps this file out of the app's TypeScript program. Vite reads no
// tsconfig paths, so the `@/` aliases are spelled out, most specific first.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/assets\//, replacement: fileURLToPath(new URL('./assets/', import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      // The shipped plugins include the built-in player, whose engine is native.
      { find: /^expo-video$/, replacement: fileURLToPath(new URL('./test/support/expo-video.ts', import.meta.url)) },
    ],
    // As in metro.config.js: what a plugin file imports is the app's copy, never the plugins repository's.
    dedupe: ['react', 'react-native', 'expo-video', 'hls.js'],
  },
  define: { __DEV__: 'true' },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    environment: 'node',
    // node:sqlite, the real SQLite the tests run the app's database on, warns that it is experimental.
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
