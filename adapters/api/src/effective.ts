import type { CapabilityKey, MediaCapability } from './capabilities';
import type { ContentKind } from './content';
import type { FieldValues } from './fields';
import { isToggle, type PluginManifest, type ToggleSetting } from './manifest';

export interface EffectiveMedia {
  readonly contentKinds: readonly ContentKind[];
  readonly capabilities: ReadonlySet<MediaCapability>;
}

/** `null` means the block is not in effect for this connection. */
export interface EffectiveCapabilities {
  readonly media: EffectiveMedia | null;
}

/**
 * What a connection may actually do: what the plugin declares, intersected
 * with what the user switched on. Application code branches on this — never on
 * the manifest, which would call features the user turned off.
 *
 * A switched-off connection has nothing in effect. A declared capability is in
 * effect when every toggle gating it is on; one no toggle gates follows its
 * connection. `settings` are the ones the connection runs with for a profile
 * (`resolveValues`), because a connection can keep them per profile.
 */
export function effectiveCapabilities(
  manifest: PluginManifest,
  connection: { readonly enabled: boolean; readonly settings: FieldValues },
): EffectiveCapabilities {
  const toggles = manifest.settings.filter(isToggle);
  const allowed = (key: CapabilityKey) =>
    toggles.every((toggle) => !toggle.gates?.includes(key) || toggleValue(toggle, connection.settings));

  const { media } = manifest;
  return {
    media:
      media && connection.enabled
        ? {
            contentKinds: media.contentKinds,
            capabilities: new Set(media.capabilities.filter((c) => allowed(`media.${c}`))),
          }
        : null,
  };
}

function toggleValue(toggle: ToggleSetting, values: FieldValues): boolean {
  const stored = values[toggle.key];
  return typeof stored === 'boolean' ? stored : toggle.default;
}
