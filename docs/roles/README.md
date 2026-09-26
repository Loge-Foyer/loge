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

Transports the app's own state to **the device's account** — iCloud, Google, a
self-hosted sync server, or this device only. A device has at most one. Later:
push, pull, status, and the owner check that resets a forgotten PIN.

A plugin declares both roles when its service does both jobs. iCloud can serve
Drive files and be the account, so it is one package with two roles. The roles
stay independently switchable: browsing iCloud Drive never makes it your
account.
