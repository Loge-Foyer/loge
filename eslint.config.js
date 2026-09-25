// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The composition root is the only place that picks concrete implementations
// (spec §15). These make that a lint error rather than a convention.
const implementations = [
  {
    group: ['@sc/plugin-*'],
    message: 'Only src/composition/ imports a concrete plugin. Use the catalogue from useServices().',
  },
  {
    group: ['@/persistence/*', '**/persistence/*'],
    message: 'Only src/composition/ imports a repository implementation. Depend on services/ports.',
  },
  {
    group: ['@/platform/*', '**/platform/*'],
    message: 'Only src/composition/ imports a platform module. Depend on services/ports.',
  },
];

const compositionRoot = {
  group: ['@/composition/*', '**/composition/*'],
  message: 'Only src/app/_layout.tsx mounts the composition root. Use useServices().',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/composition/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...implementations, compositionRoot] }],
    },
  },
  {
    files: ['src/app/_layout.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: implementations }],
    },
  },
]);
