import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // expo-video needs a native module Node does not have: the built-in player's tests drive a fake of it.
      'expo-video': fileURLToPath(new URL('./test/support/fake-expo-video.ts', import.meta.url)),
    },
  },
});
