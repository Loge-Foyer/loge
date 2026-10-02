// Starts the next release of Loge and Foyer, which always share a version:
// this repository's package.json, and the server's internal/version, beside it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { nextVersion } from './next-version.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const server = fileURLToPath(new URL('../../foyer/internal/version/version.go', import.meta.url));
const line = /^const Version = "([^"]*)"$/m;

const current = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
let go;
try {
  go = readFileSync(server, 'utf8');
} catch {
  throw new Error(`Foyer is not beside Loge: ${server} is missing.`);
}
const theirs = line.exec(go)?.[1];
if (theirs === undefined) throw new Error(`${server} holds no \`const Version = "…"\`.`);
if (theirs !== current) throw new Error(`Loge is ${current} and Foyer ${theirs}: they agree before a release, or not at all.`);

const next = nextVersion(current, new Date());
execFileSync('npm', ['version', next, '--no-git-tag-version'], { cwd: app, stdio: 'ignore' });
writeFileSync(server, go.replace(line, `const Version = "${next}"`));

console.log(`Loge and Foyer are ${next}. Commit each:

  git add package.json package-lock.json && git commit -m "build: version ${next}"
  git -C ../foyer add internal/version/version.go && git -C ../foyer commit -m "build: version ${next}"

The version is written into the native projects, and npm run ios and npm run
android never prebuild again, so prebuild before the next native build:

  npx expo prebuild --clean`);
