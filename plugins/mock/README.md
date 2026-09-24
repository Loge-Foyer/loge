# Mock

A pretend server with a deterministic catalogue, so the whole app can be built and exercised with no network at all. Carries a sync role too, so syncing can be tested end to end without a real destination.

## Roles

**Media** — exposes content. **Sync** — carries your user state.

## Settings

Exposes toggles for every gateable capability, so tests can flip them and confirm the app honours the effective set rather than the declared one.

It deliberately does **not** declare every capability. A mock that can do everything lets broken capability handling go unnoticed.

## Status

Placeholder. No implementation yet.

See `docs/writing-a-plugin/` at the repository root.
