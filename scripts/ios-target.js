// Puts ios/ in the shape the next build needs: an iPhone project, or an Apple
// TV one. Expo's TV support turns the same generated folder into one or the
// other with a clean prebuild — EXPO_TV=1 for the TV — and a build after the
// other kind would build the wrong thing, or fail to install. So this
// prebuilds again only when the folder is the other kind, or missing.
//
//   node scripts/ios-target.js phone    (npm run ios)
//   node scripts/ios-target.js tv       (npm run tvos)

const { execSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const want = process.argv[2] === 'tv' ? 'tv' : 'phone';
const podfile = path.join(root, 'ios', 'Podfile');
const have = existsSync(podfile) ? (readFileSync(podfile, 'utf8').includes('platform :tvos') ? 'tv' : 'phone') : undefined;

if (have !== want) {
  const env = { ...process.env };
  if (want === 'tv') env.EXPO_TV = '1';
  else delete env.EXPO_TV;
  console.log(`ios/ is ${have ? `an ${have === 'tv' ? 'Apple TV' : 'iPhone'} project` : 'missing'}: prebuilding it for ${want === 'tv' ? 'Apple TV' : 'iPhone'}.`);
  execSync('npx expo prebuild -p ios --clean', { cwd: root, stdio: 'inherit', env });
}
