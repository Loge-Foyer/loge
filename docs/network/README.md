# Reaching a server

How the app gets to the other side: cleartext, and client certificates.

Cleartext is **built**. Client certificates are **designed and not built** —
this page is the design, so that the shape is decided before any Swift or
Kotlin is written. Nothing described under "Client certificates" exists yet.

---

## Cleartext

A media server on a home network, and an IPTV portal anywhere, is usually
plain `http://` on a non-standard port. Both platforms refuse that by default,
so both are told not to.

- **iOS** — `NSAppTransportSecurity: { NSAllowsArbitraryLoads: true }` in
  `app.json`'s `infoPlist`.

  **`NSAllowsLocalNetworking` must not be there.** On iOS 10 and later
  `NSAllowsArbitraryLoads` is *ignored* whenever `NSAllowsLocalNetworking`,
  `NSAllowsArbitraryLoadsInWebContent` or `…ForMedia` is also present — that
  pairing is the old iOS-9 compatibility idiom, and its whole purpose is the
  fallback. Keeping both makes the policy silently do nothing, and costs a
  build to discover. Arbitrary loads is a strict superset of what local
  networking permitted, so nothing is lost.

  `NSLocalNetworkUsageDescription` stays, outside the ATS dict: it drives the
  iOS 14+ local-network privacy prompt, a separate gate a LAN request must
  also pass.
- **Android** — `usesCleartextTraffic` through `expo-build-properties`, which
  writes it onto `<application>` in the **main** manifest, so release builds
  are covered and not only the generated debug one.

**A change to either needs `npx expo prebuild`.** `npm run ios` prebuilds only
when `ios/` is absent, so an edit to `app.json` alone will not reach a build
that already has native folders.

Verifying, in order and at rising cost: `npx expo config --type introspect`
(free), `plutil -p ios/StreamingCenter/Info.plist` (after prebuild), then the
device log — the system prints *"App Transport Security has blocked a
cleartext HTTP (http://) resource load"* from the app's own process, and its
presence or absence is the verdict. That OS line contains the URL, because
Apple logged it; read it on the device and do not paste it anywhere.

---

## Client certificates (mTLS) — designed, not built

### What it is for

A household server reachable from outside usually sits behind a tunnel.
Leaving that tunnel open to anyone who finds the hostname is the thing worth
avoiding: Cloudflare Access can require a **client certificate** instead, and
refuse the connection at the edge before the origin is touched. The app has to
be able to present one.

### Why nothing in the stack can do it today

Not one of the five things that opens a socket can present a client
certificate:

| What | Reaches the network through | Can present a client certificate? |
| --- | --- | --- |
| adapters, through `PluginContext.http` | `expo/fetch` (`src/platform/http.ts`) | no |
| artwork | expo-image → SDWebImage / Glide | no |
| the built-in player | expo-video → AVPlayer / Media3 | no |
| mpv | libmpv's own IO | only from PEM files on disk |
| the web | the browser | the browser chooses, not the page |

Teaching each one separately means a different mechanism per consumer, a
private key written to disk unencrypted for mpv, and expo-video left out
entirely — a Jellyfin behind mTLS would list titles with no posters and refuse
to play.

### The shape: a loopback proxy

One app-owned Expo module, **`modules/sc-mtls`**, beside the existing
`modules/sc-pip`. It runs an HTTP/1.1 listener bound to `127.0.0.1` and
re-issues each request upstream over mTLS.

```
anything in the app ──► http://127.0.0.1:<port>/<token>/<base64url(origin)>/<path>
                              │
                        modules/sc-mtls
                              │
                              ▼
                        https://real.host/<path>   ← with the client certificate
```

Every consumer is handed an ordinary `http://` URI, so:

- **`@sc/api` does not change.** `HttpRequest` keeps its five members, and
  there is no TLS vocabulary in the contract.
- **No adapter changes.** An adapter never learns a certificate exists.
- **`PlayerContext` does not change.** An engine is handed a URI like any
  other.
- **Artwork works**, which any API-only design could not manage.
- **Downloads inherit it**, because they fetch the same URI.

The native halves are small and well-trodden: on iOS a `URLSession` whose
delegate answers `NSURLAuthenticationMethodClientCertificate` with a
`URLCredential(identity:)` from `SecPKCS12Import`; on Android an `OkHttpClient`
with an `X509KeyManager` over a PKCS#12 `KeyStore`. The module's surface is two
calls: `start(identityRef) → { origin, token }` and `stop()`.

The token is per-session and random, and sits in the path, so nothing else on
the device can use the listener. Binding to `127.0.0.1` keeps it off the
network.

### Where an identity lives, and why the device owns it

**A client certificate identifies this device**, while source and IPTV
connections belong to the account. If identities travelled with the account, a
connection's reference to one would dangle on every device that had not
imported it — and a private key would ride to your own server in plain text
and into every backup.

So identities are **device settings**, like players and sync. `DeviceSettings`
is a key→JSON document store (`src/persistence/documents.ts`), so a new
top-level key needs **no migration** — the same free ride `players.tabs` took:

```ts
// src/services/ports.ts, beside `players`
readonly tls?: {
  readonly identities: readonly TlsIdentity[];
  readonly defaultId?: string;
  /** Per connection: an identity's id, or 'none' to override the default off. */
  readonly byConnection?: Readonly<Record<string, string | 'none'>>;
};

interface TlsIdentity {
  readonly id: string;
  readonly label: string;
  /** Read from the certificate at import, for the list. Never the key. */
  readonly subject: string;
  readonly issuer: string;
  readonly notAfterMs: number;
  readonly ref: CredentialsRef;
}
```

`byConnection` is keyed by `ConnectionId`, which *is* account-wide and stable,
so the map means the same thing on every device without anything new
travelling.

**The key material goes in the device-bound credential store**
(`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) — never the `credentials` store, which
rides a backup to another phone. The row holds the metadata; the keychain holds
the bytes, under a ref, like every other secret.

**Cloudflare Access hands out a PEM certificate and key, not a `.p12`**, so the
importer takes both.

### Where it plugs in

`src/services/plugin-context.ts` builds the context per connection and already
receives the connection id at every call site
(`src/services/media/pool.ts:86`). It takes `http: deps.httpFor(connectionId)`
instead of the shared `deps.http`; `src/composition/services.ts` builds
`httpFor`, resolving **per-connection override → device default → none**. The
port stays `HttpClient`, so `src/platform/http-client.ts` is untouched.

### Two things that must be settled before any native code

1. **Manifest rewriting.** An HLS or DASH manifest can carry absolute URLs back
   to the real host, and the player would then fall off the proxy mid-stream.
   The proxy has to rewrite `m3u8` and `mpd` bodies, or the design is
   incomplete. **Prove this first** — it is the one part that could change the
   shape.
2. **A refused certificate must not be retried for ever.** Today a TLS failure
   becomes `TransportError('unreachable')` → `PROVIDER_UNAVAILABLE` /
   `backoff`, so the app would keep trying a connection that will never
   succeed. It needs an `AppErrorReason` of `'client-certificate'`, carried as
   `UNAUTHORIZED` / `never`, so the source parks until the user acts.

### The web

A browser picks client certificates itself, from the system store, and no
script can choose or install one. There is nothing to configure, and the
settings screen says so rather than offering an import that cannot work.

### Where it appears

- **Settings → App**, a "Client certificates" section: the list with each
  one's subject and expiry, Import (document picker plus passphrase), delete,
  and which is the device default.
- **The connection screen**, one synthesized row for the per-connection
  override — beside the `enabled` and `perProfile` rows the form already
  synthesizes (`src/screens/settings/connection.tsx`). It is a device setting
  shown on an account-wide form, so it says so.

### What is deliberately not decided here

Whether the proxy also serves `sync/custom-server` and the backup targets. They
go through the same `HttpClient`, so they would inherit it for free — but your
own server's sign-in is a *device* connection with no `ConnectionId` in
`byConnection`, so it needs its own answer.
