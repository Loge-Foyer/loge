# Writing a plugin

One plugin per service, whatever it does. A service that both serves media and
holds your state is one package with two roles, not two packages.

1. **Create the package** — `plugins/<id>/` with a `package.json` named
   `@sc/plugin-<id>`, `"exports": "./src/index.ts"`, and `@sc/api` as its only
   **peer** dependency: the app supplies the one copy, so the plugin and the app
   agree on every type.
2. **Write the manifest** in `src/index.ts` and export it as `plugin` (see
   `api/`). Say what the source brings (`contentKinds`) and what a connection
   needs (`connectionFields`).
3. **Declare capabilities as you implement them**, never ahead. See
   `capabilities/`.
4. **Add it to `test/manifests.test.ts`** and run `npm test`.
5. **Register it in the app** — one line in `src/composition/plugins.ts`.

Still to come, with the first real implementation: mapping remote payloads into
domain types inside the plugin, handling credentials through the injected
store, and normalizing errors.
