# Capabilities

Two levels, and the difference matters.

**Declared** capabilities are static, in the manifest: what a plugin *can* do.
**Effective** capabilities are per connection: what the user has allowed it to
do. The app branches on effective, always — branching on declared would call
features the user switched off.

## The rule

`effectiveRoles(manifest, connection)` computes it, so the app and anything
else agree on one definition:

- A **role** is in effect when the plugin declares it **and** the connection
  has it switched on. A role missing from the connection counts as off, so a
  role a plugin gains later never appears enabled on an existing connection.
- A declared **capability** is in effect when every toggle that gates it is on
  — the stored value, or the toggle's default when nothing is stored.
- A capability no toggle gates simply follows its role.

The result always has both keys: `{ media, sync }`, each `null` when that role
is not in effect.

## Declare honestly

Capabilities are not documentation. The sync engine will filter the change
journal by what you declare; claim support you lack and it hands you changes
you drop *and advances the checkpoint past them* — silent data loss.

So a capability is declared in the same change that implements it. No role is
implemented yet, which is why every real plugin declares empty lists. Only
`mock` declares a deliberately partial set, so the app's capability handling is
exercised rather than assumed.
