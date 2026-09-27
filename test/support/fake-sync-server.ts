// The sync server's routes, as the custom-server plugin calls them, held in
// memory. It knows nothing of the keys but that the proof hashes to what it
// stored — the real server's rule — so the plugin's derivation is what signs in.
import { createHash } from 'node:crypto';

import { isSyncChange, type SyncChange } from '@sc/api';

import { fakeHttp, type RecordedRequest, type Reply, type Route } from './fake-http';

interface Account {
  readonly name: string;
  readonly kdf: { readonly algorithm: string; readonly iterations: number; readonly salt: string };
  readonly verifier: string;
  vault: string;
}

const hash = (proof: string) => createHash('sha256').update(Buffer.from(proof, 'base64url')).digest('hex');
const json = (status: number, body?: unknown): Reply => ({ status, ...(body === undefined ? { text: '' } : { json: body }) });
const bodyOf = (request: RecordedRequest) => JSON.parse(request.body ?? '{}') as Record<string, unknown>;

export function fakeSyncServer(options: { readonly base?: string } = {}) {
  const base = options.base ?? '';
  const accounts = new Map<string, Account>();
  const tokens = new Map<string, { account: string; installation: string }>();
  const invites = new Set<string>(['GOOD-INVITE']);
  const log: SyncChange[] = [];
  let issued = 0;
  /** Routes a test replaces for one call or for good, by name. */
  const overrides: Record<string, Route> = {};

  const bearer = (request: RecordedRequest) => {
    const token = (request.headers.Authorization ?? '').replace(/^Bearer /, '');
    const device = tokens.get(token);
    return device && accounts.get(device.account) && { token, ...device, account: accounts.get(device.account) as Account };
  };

  const signedIn = (account: Account, installation: string) => {
    // One device per installation: signing in again replaces its token.
    for (const [token, device] of tokens) if (device.account === account.name && device.installation === installation) tokens.delete(token);
    issued += 1;
    const token = `token-${issued}`;
    tokens.set(token, { account: account.name, installation });
    return json(200, { token, device: { id: `device-${issued}` }, account: { name: account.name }, vault: account.vault });
  };

  const routes: Record<string, Route> = {
    'POST /v1/auth/params': (request) => {
      const account = accounts.get(String(bodyOf(request).username));
      return json(200, { kdf: account?.kdf ?? { algorithm: 'pbkdf2-sha256', iterations: 600_000, salt: 'AAAAAAAAAAAAAAAAAAAAAA' } });
    },
    'POST /v1/auth/login': (request) => {
      const body = bodyOf(request);
      const account = accounts.get(String(body.username));
      if (!account || hash(String(body.proof)) !== account.verifier) return json(401, { error: 'unauthorized' });
      return signedIn(account, String(body.installation));
    },
    'POST /v1/accounts': (request) => {
      const body = bodyOf(request);
      if (!invites.delete(String(body.invite))) return json(403, { error: 'invite' });
      const name = String(body.username);
      if (accounts.has(name)) return json(409, { error: 'taken' });
      const account: Account = { name, kdf: body.kdf as Account['kdf'], verifier: hash(String(body.proof)), vault: String(body.vault) };
      accounts.set(name, account);
      return signedIn(account, String(body.installation));
    },
    'POST /v1/auth/verify': (request) => {
      const device = bearer(request);
      if (!device) return json(401, { error: 'unauthorized' });
      return hash(String(bodyOf(request).proof)) === device.account.verifier ? json(204) : json(403, { error: 'wrong-proof' });
    },
    'POST /v1/auth/logout': (request) => {
      const device = bearer(request);
      if (!device) return json(401, { error: 'unauthorized' });
      tokens.delete(device.token);
      return json(204);
    },
    'GET /v1/status': (request) => {
      const device = bearer(request);
      return device ? json(200, { account: { name: device.account.name }, device: { id: 'device', name: 'Test Phone' } }) : json(401, { error: 'unauthorized' });
    },
    'GET /v1/sync/pull': (request) => {
      if (!bearer(request)) return json(401, { error: 'unauthorized' });
      const from = request.query.cursor === undefined ? 0 : Number(request.query.cursor.replace('at-', ''));
      const changes = log.slice(from, from + 200);
      return json(200, { kind: 'changes', changes, cursor: `at-${from + changes.length}`, more: from + changes.length < log.length });
    },
    'POST /v1/sync/push': (request) => {
      if (!bearer(request)) return json(401, { error: 'unauthorized' });
      const accepted: string[] = [];
      for (const change of bodyOf(request).changes as unknown[]) {
        if (!isSyncChange(change)) break;
        if (!log.some((stored) => stored.id === change.id)) log.push(change);
        accepted.push(change.id);
      }
      return json(200, { accepted });
    },
  };

  const table: Record<string, Route> = {};
  for (const name of Object.keys(routes)) {
    const [method, path] = name.split(' ');
    table[`${method} ${base}${path}`] = (request, calls) => {
      const route = overrides[name] ?? routes[name];
      if (route === undefined) return json(404);
      return typeof route === 'function' ? route(request, calls) : route;
    };
  }
  const http = fakeHttp(table);
  return {
    http,
    log,
    accounts,
    tokens,
    invites,
    /** Answers a route differently from now on — until `restore`. */
    override: (name: string, route: Route) => {
      overrides[name] = route;
    },
    restore: (name: string) => {
      delete overrides[name];
    },
    /** `sc-sync revoke`: every device of the account is let go. */
    revokeAll: () => tokens.clear(),
    /** Requests to one route, by its name without the base path. */
    to: (name: string) => {
      const [method, path] = name.split(' ');
      return http.to(`${method} ${base}${path}`);
    },
  };
}

export type FakeSyncServer = ReturnType<typeof fakeSyncServer>;
