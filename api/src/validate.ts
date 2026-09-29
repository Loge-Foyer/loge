import type { CapabilityKey, SyncCapability } from './capabilities';
import { categoryOfPluginId, PLATFORMS, PLUGIN_CATEGORIES, type PluginCategory } from './category';
import { isLibrarySelection, type Field } from './fields';
import { isToggle, type PluginManifest } from './manifest';

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
/** The one block each category declares. A sync plugin's `sync` block is Phase 4's, until Phase 6 retires it. */
const CATEGORY_BLOCKS: Readonly<Record<PluginCategory, readonly Block[]>> = {
  sources: ['media'],
  iptv: ['media'],
  players: ['player'],
  sync: ['account', 'backup', 'sync'],
};
type Block = 'media' | 'sync' | 'player' | 'account' | 'backup';
const BLOCKS: readonly Block[] = ['media', 'sync', 'player', 'account', 'backup'];
const KEY = /^[a-z][A-Za-z0-9]*$/;
const SECRET_LOOKING = /password|passcode|passphrase|token|secret|apikey/i;
const PER_PROFILE_SYNC: readonly SyncCapability[] = ['preferences', 'watchProgress', 'favorites', 'watchlist', 'history', 'customLists'];

/**
 * Problems with a manifest, empty when it is sound. A manifest is static, so a
 * problem here is a programming error in the plugin, not a runtime condition.
 */
export function validateManifest(manifest: PluginManifest): readonly string[] {
  const problems: string[] = [];
  const { media, sync, connectionFields, settings, category, platforms } = manifest;
  const blocks = BLOCKS.filter((block) => manifest[block] !== undefined);

  if (category === undefined) {
    if (!PLUGIN_ID.test(manifest.id)) problems.push(`id "${manifest.id}" must be kebab-case`);
  } else if (!(PLUGIN_CATEGORIES as readonly string[]).includes(category)) {
    problems.push(`category "${category}" is not one of ${PLUGIN_CATEGORIES.join(', ')}`);
  } else {
    // The id is the plugin's folder under plugins/: its category, then its name.
    if (categoryOfPluginId(manifest.id) !== category) problems.push(`id "${manifest.id}" must be "${category}/<kebab-case name>"`);
    const allowed = CATEGORY_BLOCKS[category];
    for (const block of blocks) {
      if (!allowed.includes(block)) problems.push(`a ${category} plugin cannot declare the ${block} block`);
    }
    if (blocks.length > 1) problems.push(`declares ${blocks.join(' and ')}; a plugin declares one block`);
  }
  if (platforms !== undefined) {
    if (platforms.length === 0) problems.push('runs on no platform');
    for (const platform of platforms) {
      if (!(PLATFORMS as readonly string[]).includes(platform)) problems.push(`platform "${platform}" is not one of ${PLATFORMS.join(', ')}`);
    }
    for (const platform of duplicates(platforms)) problems.push(`platform "${platform}" is listed twice`);
  }
  if (manifest.displayName.trim() === '') problems.push('displayName is empty');
  if (manifest.description.trim() === '') problems.push('description is empty');
  if (blocks.length === 0) problems.push('declares no role');

  if (media) {
    if (media.contentKinds.length === 0) problems.push('media role brings no content kind');
    for (const kind of duplicates(media.contentKinds)) problems.push(`content kind "${kind}" is listed twice`);
    for (const c of duplicates(media.capabilities)) problems.push(`media capability "${c}" is listed twice`);
  }
  if (sync) {
    for (const c of duplicates(sync.capabilities)) problems.push(`sync capability "${c}" is listed twice`);
    problems.push(...accountFieldProblems(sync, connectionFields));
    // A sealed password travels inside a connection's change.
    if (sync.capabilities.includes('sealedPasswords') && !sync.capabilities.includes('providerConnections')) {
      problems.push('sync capability "sealedPasswords" needs "providerConnections"');
    }
  }

  for (const [list, entries] of [
    ['connection field', connectionFields],
    ['setting', settings],
  ] as const) {
    for (const entry of entries) {
      if (!KEY.test(entry.key)) problems.push(`${list} key "${entry.key}" must be camelCase`);
    }
    for (const key of duplicates(entries.map((entry) => entry.key))) {
      problems.push(`${list} key "${key}" is declared twice`);
    }
  }

  if (manifest.account) problems.push(...accountFieldProblems(manifest.account, connectionFields));
  if (manifest.player) {
    for (const [platform, profile] of Object.entries(manifest.player.profiles)) {
      if (platforms !== undefined && !(platforms as readonly string[]).includes(platform)) {
        problems.push(`player profile for "${platform}", which the plugin does not run on`);
      }
      if (profile && profile.protocols.length === 0) problems.push(`player profile for "${platform}" plays no protocol`);
    }
  }
  if (manifest.backup && manifest.backup.location.trim() === '') problems.push('backup location is empty');

  for (const field of [...connectionFields, ...settings, ...(sync?.signUp?.fields ?? []), ...(manifest.account?.signUp?.fields ?? [])]) {
    if (field.type !== 'select') continue;
    const values = field.options.map((option) => option.value);
    if (values.length === 0) problems.push(`select "${field.key}" has no options`);
    for (const value of duplicates(values)) problems.push(`select "${field.key}" lists "${value}" twice`);
    if (!values.includes(field.default)) problems.push(`select "${field.key}" defaults to a missing option`);
  }

  // The app fills a libraries setting by asking the connection for its libraries.
  const librarySettings = settings.filter((setting) => setting.type === 'libraries');
  if (librarySettings.length > 0 && !media?.capabilities.includes('libraries')) {
    problems.push('a libraries setting needs the media capability "libraries"');
  }
  if (librarySettings.length > 1) problems.push('declares more than one libraries setting');
  for (const setting of librarySettings) {
    if (!isLibrarySelection(setting.default)) {
      problems.push(`libraries setting "${setting.key}" has an invalid default`);
    }
  }

  // A credential is part of an account the connection signs in with, so it is a connection field.
  for (const setting of settings) {
    if (setting.type === 'text' && setting.credential) {
      problems.push(`setting "${setting.key}" cannot be a credential; credentials are connection fields`);
    }
  }

  // Settings are stored in plain text; anything that looks secret belongs in a password field.
  for (const field of connectionFields) {
    if (field.type !== 'password' && SECRET_LOOKING.test(field.key)) {
      problems.push(`connection field "${field.key}" looks secret but is not a password field`);
    }
  }
  for (const setting of settings) {
    if (SECRET_LOOKING.test(setting.key)) {
      problems.push(`setting "${setting.key}" looks secret; secrets must be password connection fields`);
    }
  }

  const declared = new Set<CapabilityKey>([
    ...(media?.capabilities ?? []).map((c) => `media.${c}` as const),
    ...(sync?.capabilities ?? []).map((c) => `sync.${c}` as const),
  ]);
  const toggles = settings.filter(isToggle);
  for (const toggle of toggles) {
    const gates = toggle.gates ?? [];
    for (const gate of gates) {
      if (!declared.has(gate)) problems.push(`setting "${toggle.key}" gates undeclared "${gate}"`);
    }
    if (new Set(gates.map((gate) => gate.slice(0, gate.indexOf('.')))).size > 1) {
      problems.push(`setting "${toggle.key}" gates more than one role`);
    }
  }

  // An account keeps these per profile, so it cannot carry them without the profiles.
  for (const capability of sync?.capabilities ?? []) {
    if (PER_PROFILE_SYNC.includes(capability) && !sync?.capabilities.includes('profile')) {
      problems.push(`sync capability "${capability}" needs "profile"`);
    }
  }

  return problems;
}

/** An account's owner proof and sign-up fields, whichever block declares them. */
function accountFieldProblems(
  block: { readonly ownerProof?: { readonly fields: readonly string[] }; readonly signUp?: { readonly fields: readonly Field[] } },
  connectionFields: readonly Field[],
): readonly string[] {
  const problems: string[] = [];
  // The owner check asks for these again, as passwords, so they must be the connection's password fields.
  const passwords = new Set(connectionFields.filter((field) => field.type === 'password').map((field) => field.key));
  const proof = block.ownerProof?.fields;
  if (proof?.length === 0) problems.push('ownerProof names no field');
  for (const key of proof ?? []) {
    if (!passwords.has(key)) problems.push(`ownerProof field "${key}" is not a password connection field`);
  }
  // Sign-up values are handed to `createAccount` once and never kept, so none is a saved secret.
  const signUp = block.signUp?.fields ?? [];
  for (const field of signUp) {
    if (!KEY.test(field.key)) problems.push(`sign-up field key "${field.key}" must be camelCase`);
    if (field.type === 'password') problems.push(`sign-up field "${field.key}" cannot be a password field`);
    if (connectionFields.some((connectionField) => connectionField.key === field.key)) {
      problems.push(`sign-up field "${field.key}" clashes with a connection field`);
    }
  }
  for (const key of duplicates(signUp.map((field) => field.key))) problems.push(`sign-up field key "${key}" is declared twice`);
  return problems;
}

function duplicates<T>(values: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  const repeated = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}
