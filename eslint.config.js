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

// Hermes, the engine on iOS and Android, lacks a few built-ins a browser has.
// Code using them typechecks and works on the web, then throws on a phone.
const missingOnHermes = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.property.name='toSorted']",
      message: 'Hermes has no Array.prototype.toSorted. Copy, then sort: [...list].sort(compare).',
    },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Object', property: 'groupBy', message: 'Hermes has no Object.groupBy.' },
    { object: 'crypto', property: 'randomUUID', message: 'Hermes has no crypto.randomUUID. Use expo-crypto.' },
  ],
};

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
    rules: missingOnHermes,
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
