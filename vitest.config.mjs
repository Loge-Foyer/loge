import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// `.mjs` keeps this file out of the app's TypeScript program. Vite reads no
// tsconfig paths, so the `@/` aliases are spelled out, most specific first.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/assets\//, replacement: fileURLToPath(new URL('./assets/', import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      // The shipped plugins include the built-in player and VLC, whose engines are native.
      { find: /^expo-video$/, replacement: fileURLToPath(new URL('./test/support/expo-video.ts', import.meta.url)) },
      { find: /^expo$/, replacement: fileURLToPath(new URL('./test/support/expo.ts', import.meta.url)) },
    ],
    // One copy of each, whichever workspace asks for it.
    dedupe: ['react', 'react-native', 'expo', 'expo-video', 'hls.js', 'mpegts.js'],
  },
  define: { __DEV__: 'true' },
  test: {
    // Named explicitly, because the adapters are npm workspaces now and vitest
    // would otherwise take each of them for a project of its own and run this
    // app's tests under the wrong root. There are two suites here, and these
    // are they.
    projects: ['./vitest.config.mjs', './adapters/vitest.config.ts'],
    name: 'app',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    environment: 'node',
    // node:sqlite, the real SQLite the tests run the app's database on, warns that it is experimental.
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
