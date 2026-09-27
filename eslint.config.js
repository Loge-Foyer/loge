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

// expo-sqlite's transaction helpers break the database's rules: the plain one
// folds whatever else runs meanwhile into the transaction, the exclusive one
// runs on a second connection where foreign keys — and so cascades — are off.
// Transactions go through persistence/sqlite/sql.ts instead.
const sqliteTransactionHelpers = [
  {
    selector: "CallExpression[callee.property.name=/^with(Exclusive)?TransactionAsync$/]",
    message: 'Use LocalDatabase.transaction(): expo-sqlite’s transaction helpers let other statements in, or switch foreign keys off.',
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
    {
      selector: "CallExpression[callee.name='structuredClone']",
      message: 'Hermes may lack structuredClone. Keep values immutable, or copy them explicitly.',
    },
    ...sqliteTransactionHelpers,
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Object', property: 'groupBy', message: 'Hermes has no Object.groupBy.' },
    { object: 'crypto', property: 'randomUUID', message: 'Hermes has no crypto.randomUUID. Use expo-crypto.' },
    { object: 'Promise', property: 'withResolvers', message: 'Hermes may lack Promise.withResolvers. Use new Promise((resolve, reject) => …).' },
    { object: 'Intl', property: 'RelativeTimeFormat', message: 'Hermes may lack Intl.RelativeTimeFormat. Say how long ago by hand, as components/labels.ts does.' },
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
