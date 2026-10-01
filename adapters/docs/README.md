# Documentation — the Streaming Center adapters

How to build an adapter, and the contracts every adapter implements.

Start with `api/`. It is the vocabulary everything else is written in. Then
`categories/` — which of the four kinds your adapter is — then
`writing-a-plugin/`, then `capabilities/` and `settings/`. Those two together
decide what the app will actually call.

| Folder | What is there |
| --- | --- |
| `api/` | Every module of `@sc/api`, the manifest, and each contract |
| `categories/` | Sources, IPTV, players and sync: what each does, and where it shows |
| `writing-a-plugin/` | Step by step, with what matters inside each category |
| `capabilities/` | Declared versus effective, and what each capability promises |
| `settings/` | Connection fields, settings, toggles, per-profile values |
| `testing/` | The TypeScript programs, the fakes, conformance |
| `getting-started/` | The layout and the commands |
| `publishing/` | How the app consumes the packages |
