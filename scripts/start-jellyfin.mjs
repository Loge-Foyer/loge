// `npm run start:jellyfin -- [--web|--ios|--android]`
//
// Starts Metro with a development seed that connects the Jellyfin server in the
// workspace's `jellyfin.env` (gitignored), so the connection is there again
// after every reload while storage is still in memory. Development only.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveServerUrl, parseEnv } from './jellyfin-env.mjs';

if (process.env.CI) {
  console.error('start:jellyfin is for development on your own machine, never for CI or a build.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const file = process.env.SC_JELLYFIN_ENV ?? resolve(here, '../../jellyfin.env');

let values;
try {
  values = parseEnv(readFileSync(file, 'utf8'));
} catch {
  console.error(`Could not read ${file}. Put the server's details there (web_ui or ip, username, password), or set SC_JELLYFIN_ENV.`);
  process.exit(1);
}

const url = deriveServerUrl(values);
const missing = [...(url ? [] : ['web_ui or ip']), ...(values.username ? [] : ['username'])];
if (missing.length > 0) {
  console.error(`${file} is missing: ${missing.join(', ')}.`);
  process.exit(1);
}

// Stable for this machine and user, so reloading the web build does not add a
// device to the server on every launch.
const installationId = createHash('sha256').update(`${hostname()}|${userInfo().username}`).digest('hex').slice(0, 32);

// Key names only: the values stay out of the terminal and its scrollback.
console.log(`Seeding the Jellyfin server from ${file} (found: ${Object.keys(values).join(', ')}).`);
console.log('Note: the password is inlined into the development bundle Metro serves on your network. Use a test account.');

const child = spawn('npx', ['expo', 'start', '--clear', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_PUBLIC_DEV_SEED: 'jellyfin',
    EXPO_PUBLIC_DEV_JELLYFIN_URL: url,
    EXPO_PUBLIC_DEV_JELLYFIN_USERNAME: values.username,
    EXPO_PUBLIC_DEV_JELLYFIN_PASSWORD: values.password ?? '',
    EXPO_PUBLIC_DEV_INSTALLATION_ID: installationId,
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
