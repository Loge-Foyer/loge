---
name: sc-plugin-roles
description: Add or change a role on an existing Streaming Center plugin — giving a media source a sync role or vice versa — including the capability toggles that gate it. Use when a service should start doing something it does not do yet.
---

# Adding a role to an existing plugin

A plugin already exists for the service. You want it to do something new — an
account provider should also serve files, or a file service should also become
an account.

**Do not create a second package.** Add the role to the existing manifest.

**Media servers do not get a sync role.** Jellyfin, Emby and Plex are the master
of what their users watched. Reading that is `watchStateRead`, and writing
progress back is `watchStateWrite` — both media capabilities. A device has at
most one sync connection, its account, and a media server is never it.

## Why not a second package

The original specification called the media/sync separation mandatory. What that
rule protected was the arrangement people actually want — *files from Google
Drive, the account somewhere else* — not the existence of two npm packages.

That property is preserved by the **roles being independently switchable**, not
by the packaging. Split the package and you gain nothing; you just make the user
configure the same server twice.

## Checklist

1. **Add the role to the manifest.** `media` and `sync` are both optional:

   ```ts
   manifest: {
     id: pluginId('google'),
     displayName: 'Google Drive',
     media: { contentKinds: ['files'], capabilities: [...] },
     sync:  { capabilities: [...] },              // ← the new one
     connectionFields: [...],                     // shared by both roles
     settings: [...],
   }
   ```

2. **Declare only what the service can genuinely carry.** An account that can
   store a watch history but not a home layout must not declare
   `preferences`. Declaring it anyway means the engine hands you preference
   changes, you drop them, and the checkpoint advances past them — the state is
   gone and nothing errors.

3. **Add a toggle per gateable capability, defaulting to `false`.**

   ```ts
   {
     key: 'syncWatchProgress',
     label: 'Sync watch progress to this server',
     type: 'boolean',
     default: false,
     gates: ['sync.watchProgress'],
   }
   ```

   **Every sync toggle starts off.** Someone who connected this plugin last
   month to watch films must not discover their history is now being uploaded
   because you shipped a new role.

4. **Do not widen the connection form unnecessarily.** `connectionFields` are
   shared by every role, so the new role already has the existing endpoint and
   credentials. Adding required fields breaks existing connections.

5. **Update the plugin's `README.md`** (Roles, Brings, Settings) in the same
   commit.

6. **Update the roster** in `../.claude/streaming-center-architecture.md`
   section 8 and the table in this repository's `AGENTS.md` and `README.md`.

## The thing that will break

Existing connections were stored without the new role. They must keep working,
with the new role **off**, and no migration prompt. A role appearing enabled on
an existing connection is a bug, not a feature. `effectiveRoles` already treats
a role missing from `connection.roles` as off — keep it that way.

## Removing a role

Harder than adding one, because connections may have it enabled and state may
already have been pushed. Do not silently drop it — the plugin should keep
declaring the role until there is a migration story.

## Verify

```bash
npm run typecheck
npm test
```

And in the app, confirm it branches on **effective** capabilities — declared
intersected with enabled — not declared alone. Branching on declared is what
turns a defaulted-off toggle into an active sync.
