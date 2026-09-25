import type { CapabilityKey } from './capabilities';
import { isToggle, type PluginManifest } from './manifest';

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
const KEY = /^[a-z][A-Za-z0-9]*$/;
const SECRET_LOOKING = /password|passcode|passphrase|token|secret|apikey/i;

/**
 * Problems with a manifest, empty when it is sound. A manifest is static, so a
 * problem here is a programming error in the plugin, not a runtime condition.
 */
export function validateManifest(manifest: PluginManifest): readonly string[] {
  const problems: string[] = [];
  const { media, sync, connectionFields, settings } = manifest;

  if (!PLUGIN_ID.test(manifest.id)) problems.push(`id "${manifest.id}" must be kebab-case`);
  if (manifest.displayName.trim() === '') problems.push('displayName is empty');
  if (manifest.description.trim() === '') problems.push('description is empty');
  if (!media && !sync) problems.push('declares no role');

  if (media) {
    if (media.contentKinds.length === 0) problems.push('media role brings no content kind');
    for (const kind of duplicates(media.contentKinds)) problems.push(`content kind "${kind}" is listed twice`);
    for (const c of duplicates(media.capabilities)) problems.push(`media capability "${c}" is listed twice`);
  }
  if (sync) {
    for (const c of duplicates(sync.capabilities)) problems.push(`sync capability "${c}" is listed twice`);
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

  for (const field of [...connectionFields, ...settings]) {
    if (field.type !== 'select') continue;
    const values = field.options.map((option) => option.value);
    if (values.length === 0) problems.push(`select "${field.key}" has no options`);
    for (const value of duplicates(values)) problems.push(`select "${field.key}" lists "${value}" twice`);
    if (!values.includes(field.default)) problems.push(`select "${field.key}" defaults to a missing option`);
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
    if (toggle.default && gates.some((gate) => gate.startsWith('sync.'))) {
      problems.push(`setting "${toggle.key}" gates sync and must default to false`);
    }
  }
  for (const capability of sync?.capabilities ?? []) {
    const key = `sync.${capability}` as const;
    if (!toggles.some((toggle) => toggle.gates?.includes(key))) {
      problems.push(`sync capability "${capability}" has no toggle`);
    }
  }

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
