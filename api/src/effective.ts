import type { CapabilityKey, MediaCapability, SyncCapability } from './capabilities';
import type { ConnectionRoles } from './connection';
import type { ContentKind } from './content';
import type { FieldValues } from './fields';
import { isToggle, type PluginManifest, type ToggleSetting } from './manifest';

export interface EffectiveMedia {
  readonly contentKinds: readonly ContentKind[];
  readonly capabilities: ReadonlySet<MediaCapability>;
}

export interface EffectiveSync {
  readonly capabilities: ReadonlySet<SyncCapability>;
}

/** `null` means the role is not in effect for this connection. */
export interface EffectiveRoles {
  readonly media: EffectiveMedia | null;
  readonly sync: EffectiveSync | null;
}

/**
 * What a connection may actually do: what the plugin declares, intersected
 * with what the user switched on. Application code branches on this — never on
 * the manifest, which would call features the user turned off.
 *
 * A role is in effect when it is declared and switched on. A declared
 * capability is in effect when every toggle gating it is on; one no toggle
 * gates follows its role. `settings` are the ones the connection runs with for
 * a profile (`resolveValues`), because a connection can keep them per profile.
 */
export function effectiveRoles(
  manifest: PluginManifest,
  connection: { readonly roles: ConnectionRoles; readonly settings: FieldValues },
): EffectiveRoles {
  const toggles = manifest.settings.filter(isToggle);
  const allowed = (key: CapabilityKey) =>
    toggles.every(
      (toggle) => !toggle.gates?.includes(key) || toggleValue(toggle, connection.settings),
    );

  const { media, sync } = manifest;
  return {
    media:
      media && connection.roles.media === true
        ? {
            contentKinds: media.contentKinds,
            capabilities: new Set(media.capabilities.filter((c) => allowed(`media.${c}`))),
          }
        : null,
    sync:
      sync && connection.roles.sync === true
        ? { capabilities: new Set(sync.capabilities.filter((c) => allowed(`sync.${c}`))) }
        : null,
  };
}

function toggleValue(toggle: ToggleSetting, values: FieldValues): boolean {
  const stored = values[toggle.key];
  return typeof stored === 'boolean' ? stored : toggle.default;
}
