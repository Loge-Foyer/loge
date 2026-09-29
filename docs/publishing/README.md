# Publishing

Nothing is published. Every package here is private, TypeScript source with no
build step, and the app links it straight from this repository.

- **Linking.** The app lists `@sc/api` and each plugin as `file:` dependencies,
  by folder:
  - `file:../streaming_center_plugins/plugins/sources/jellyfin`
  - …and likewise for every other plugin.
  - Metro watches this whole repository.
- **Package names** follow the category: `@sc/source-<name>`,
  `@sc/iptv-<name>`, `@sc/player-<name>`, `@sc/sync-<name>`, plus `@sc/api`
  and `@sc/player-kit`.
- **One copy of `api`.** Every plugin takes `@sc/api` as a peer dependency,
  so the app supplies the one instance and branded ids agree.
- **Native code** in a player plugin is picked up by the app's development
  build through Expo's autolinking. A native change means building the app
  again.

Until Phase 6 regroups them, the packages are `@sc/plugin-<id>` at
`plugins/<id>/`.
