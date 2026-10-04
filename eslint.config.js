// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The composition root is the only place that picks concrete implementations
// (spec §15). These make that a lint error rather than a convention.
const implementations = [
  {
    // A source, IPTV, player, sync or metadata package. @loge/player-kit is the player contract: its types go anywhere (below).
    group: ['@loge/source-*', '@loge/iptv-*', '@loge/player-*', '!@loge/player-kit', '@loge/sync-*', '@loge/metadata-*'],
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
    {
      selector: "CallExpression[callee.property.name=/^(toBase64|fromBase64)$/]",
      message: 'Hermes has no Uint8Array base64 methods. Use encodeBase64Url / decodeBase64Url from @loge/api.',
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

// Cryptography is the platform's (spec §3): one implementation, which plugins
// reach through their context and services through the crypto port.
const cryptography = {
  group: ['@noble/*'],
  message: 'Only src/platform/ does cryptography. Take the host crypto the composition root hands you.',
};

// Asking for the device's owner is a platform module's job; everything else
// goes through the owner check. Flat config replaces a rule's options per
// matching block, so this path sits in the block that holds the boundary
// patterns, and src/platform/ gets a block of its own restating them.
const ownerAuthentication = {
  name: 'expo-local-authentication',
  message: 'Only src/platform/ asks for the device owner. Use the owner check from useServices().',
};

// sql.js is for backups on the web and nothing else: a backup's database, in
// memory. It comes in through import(), so the entry bundle never carries it.
// The rule sees static imports only, which is exactly what it should forbid:
// sql.web.ts's import() of sql-js-web passes, and a static one anywhere fails.
const sqlJs = {
  name: 'sql.js',
  message: 'Only src/persistence/backup/sql-js*.ts uses sql.js — a backup’s database, nothing else.',
};
const sqlJsChunk = {
  group: ['**/sql-js-web'],
  message: 'Load sql-js-web through import(), as sql.web.ts does, so sql.js stays out of the entry bundle.',
};

// An engine is its player plugin's business (spec §9). The app installs
// expo-video and hls.js only so that autolinking builds the one and Metro
// bundles one copy of each; nothing here imports them, the composition root
// included — it imports the player plugin.
const playerEngines = [
  { name: 'expo-video', message: 'The app never imports an engine. The player plugin drives it; take its controller and view from useServices().' },
  { name: 'hls.js', message: 'The app never imports an engine. The built-in player loads hls.js itself, on the web, when it needs it.' },
  { name: 'mpegts.js', message: 'The app never imports an engine. The built-in player loads mpegts.js itself, on the web, when a stream needs it.' },
];

// Tamagui's controls hear touches alone, and a TV remote's select arrives as a
// click only React Native's Pressable hears. components/button.tsx wraps
// Tamagui's Button so a remote can press it; one taken from Tamagui directly
// takes the focus on a TV and ignores the select.
const tamaguiButton = {
  name: 'tamagui',
  importNames: ['Button'],
  message: 'Use Button from @/components/button: on a TV only that one can be pressed with the remote.',
};

// @loge/player-kit holds only types, the React half of the player contract. A
// screen may name them; the views themselves come from the composition root,
// through useServices() — so nothing else imports it for real.
const playerKitTypesOnly = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: '@loge/player-kit',
          allowTypeImports: true,
          message: 'Only types from @loge/player-kit outside src/composition/. The views come from useServices().',
        },
      ],
    },
  ],
};

// Each tab is a UI of its own (docs/ui): a tab never reaches into another, its
// phone and TV halves never into each other — what both use sits in `shared/` —
// and nothing outside src/tabs reaches in but the routes, through @/tabs/<tab>.
const TABS = ['media', 'videos', 'live'];
const tabZones = [
  ...TABS.map((tab) => ({
    target: `./src/tabs/${tab}`,
    from: TABS.filter((other) => other !== tab).map((other) => `./src/tabs/${other}`),
    message: 'A tab never imports another tab. What two tabs need belongs in src/components, src/hooks or src/services.',
  })),
  ...TABS.flatMap((tab) => [
    { target: `./src/tabs/${tab}/mobile`, from: `./src/tabs/${tab}/tv`, message: 'The phone’s UI never imports the TV’s. Share it through shared/.' },
    { target: `./src/tabs/${tab}/tv`, from: `./src/tabs/${tab}/mobile`, message: 'The TV’s UI never imports the phone’s. Share it through shared/.' },
    {
      target: `./src/tabs/${tab}/shared`,
      from: [`./src/tabs/${tab}/mobile`, `./src/tabs/${tab}/tv`],
      message: 'shared/ is what both form factors use, so it imports neither.',
    },
  ]),
  {
    target: ['./src/components', './src/hooks', './src/services', './src/screens', './src/platform', './src/persistence', './src/composition'],
    from: './src/tabs',
    message: 'Only routes import a tab, through @/tabs/<tab>. Move what is shared out of the tab instead.',
  },
];

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
    rules: { 'import/no-restricted-paths': ['error', { zones: tabZones }] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/composition/**'],
    rules: playerKitTypesOnly,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/composition/**', 'src/platform/**', 'src/components/button.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [...playerEngines, ownerAuthentication, sqlJs, tamaguiButton], patterns: [...implementations, compositionRoot, cryptography, sqlJsChunk] },
      ],
    },
  },
  {
    files: ['src/components/button.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [...playerEngines, ownerAuthentication, sqlJs], patterns: [...implementations, compositionRoot, cryptography, sqlJsChunk] },
      ],
    },
  },
  {
    files: ['src/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...playerEngines, sqlJs], patterns: [...implementations, compositionRoot, sqlJsChunk] }],
    },
  },
  {
    files: ['src/composition/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...playerEngines, ownerAuthentication, sqlJs], patterns: [cryptography, sqlJsChunk] }],
    },
  },
  {
    files: ['src/app/_layout.tsx'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...playerEngines, ownerAuthentication, sqlJs], patterns: [...implementations, cryptography, sqlJsChunk] }],
    },
  },
  {
    files: ['src/persistence/backup/sql-js.ts', 'src/persistence/backup/sql-js-web.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...playerEngines, ownerAuthentication], patterns: [...implementations, compositionRoot, cryptography, sqlJsChunk] }],
    },
  },
]);
