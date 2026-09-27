# Roles

A plugin declares one or both roles. Which of them a connection actually uses
is the user's choice, per connection.

## Media

Exposes content. It declares `contentKinds`, what the source brings:

| Kind | Meaning |
| --- | --- |
| `movies` | films |
| `shows` | series and their episodes |
| `anime` | anime, where a source distinguishes it |
| `videos` | web video — YouTube-style channels and uploads |
| `files` | plain files on a drive or a share |

The plugin only states what it brings; where each kind is shown is the app's
decision. The role connects (`plugin.media.connect`), lists in a given order,
opens titles, lists a show's seasons and a season's episodes, reports what the
user watched, and resolves artwork. Search and playback come later.

A media server is the **master of its own watch state**: what each of its users
watched lives on the server. The app reads it through the media role
(`watchStateRead`), and will write progress back through it too
(`watchStateWrite`). That is why Jellyfin, Emby and Plex have no sync role.

## Sync

Carries the app's own state to **the device's account** — iCloud, Google, or a
self-hosted sync server. A device has at most one, and needs none: without an
account, everything stays on the device. The role connects
(`plugin.sync.connect`), pushes this device's changes, pulls everyone else's,
reports its status and, where it can, re-verifies the owner — which is how a
forgotten PIN is reset. An owner check that takes a password says which fields
it asks for again (`sync.ownerProof`).

An account carries what its plugin declares (`capabilities/`). Signing in is
the opt-in, so there is nothing to switch on afterwards. A connection's
passwords travel only to an account that declares `sealedPasswords`, and only
sealed by the app with a key the account never sees.

A plugin declares both roles when its service does both jobs. iCloud can serve
Drive files and be the account, so it is one package with two roles. The roles
stay independent: a new connection starts with its sync role off, and only
choosing it as the account switches it on. Browsing iCloud Drive never makes
it your account.
