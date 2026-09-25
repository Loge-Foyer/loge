# Roles

A plugin declares one or both roles. Which of them a connection actually uses
is the user's choice, per connection.

**Media** — exposes content. It declares `contentKinds`, what the source brings:

| Kind | Meaning |
| --- | --- |
| `movies` | films |
| `shows` | series and their episodes |
| `anime` | anime, where a source distinguishes it |
| `videos` | web video — YouTube-style channels and uploads |
| `files` | plain files on a drive or a share |

The plugin only states what it brings; where each kind is shown is the app's
decision. Later the role will connect, list, search, fetch details and resolve
playback.

**Sync** — transports the app's own user state. Later: push, pull, status.

A plugin declares both when its service does both — Jellyfin serves a library
and holds viewing state, so it is one package with two roles. They stay
independently switchable, which is what makes one package safe: using Jellyfin
for films never starts sending your history there.

No role has an implementation yet. The manifests declare what each service is,
not what the code can do today.
