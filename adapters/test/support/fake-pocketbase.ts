// Your own server's routes, as the custom-server plugin calls them, held in
// memory: PocketBase's sign-in, sessions, record lists and batch, and the
// server's two routes — with the rules its hooks add. Enough to hold the
// plugin to the protocol; the Go tests hold the real server to it.
import { createHash } from 'node:crypto';

import { fakeHttp, type RecordedRequest, type Reply, type Route } from './fake-http';

interface Account {
  readonly id: string;
  readonly username: string;
  password: string;
}

type Stored = Record<string, unknown>;

export const COLLECTION_KINDS: Readonly<Record<string, string>> = {
  profiles: 'profile',
  profile_pins: 'pin',
  preferences: 'preference',
  connections: 'connection',
  connection_profile_values: 'profileValues',
  subscriptions: 'subscription',
  favorite_channels: 'favoriteChannel',
  playlists: 'playlist',
};

const json = (status: number, body?: unknown): Reply => ({ status, json: body ?? {} });
const bodyOf = (request: RecordedRequest) => JSON.parse(request.body ?? '{}') as Record<string, unknown>;

/** `recordId()` in the api, as the server derives it. */
export function derivedId(accountId: string, kind: string, key: string): string {
  return createHash('sha256').update(`${accountId}\n${kind}\n${key}`).digest('hex').slice(0, 15);
}

export function fakePocketBase(options: { readonly base?: string; readonly maxProfiles?: number; readonly signUp?: 'invite' | 'open' | 'closed' } = {}) {
  const base = options.base ?? '';
  const maxProfiles = options.maxProfiles ?? 10;
  const accounts = new Map<string, Account>();
  const tokens = new Map<string, string>();
  const invites = new Set<string>(['GOOD-INVITE']);
  const records = new Map<string, Map<string, Stored>>();
  let issued = 0;
  let throttled = false;
  /** Routes a test replaces, by name. */
  const overrides: Record<string, Route> = {};

  const accountOf = (request: RecordedRequest) => {
    const id = tokens.get(request.headers.Authorization ?? '');
    return id === undefined ? undefined : accounts.get(id);
  };
  const byName = (name: string) => [...accounts.values()].find((account) => account.username.toLowerCase() === name.toLowerCase());
  const signedIn = (account: Account): Reply => {
    issued += 1;
    const token = `token-${issued}`;
    tokens.set(token, account.id);
    return json(200, { token, record: { id: account.id, username: account.username, collectionName: 'users' } });
  };
  const storeOf = (account: Account) => {
    const found = records.get(account.id) ?? new Map<string, Stored>();
    records.set(account.id, found);
    return found;
  };
  const create = (username: string, password: string) => {
    const account: Account = { id: `acct${String(accounts.size + 1).padStart(11, '0')}`, username, password };
    accounts.set(account.id, account);
    return account;
  };

  /** One write, judged as the server's hooks judge it; the refusal's code, or nothing. */
  const judge = (account: Account, next: Map<string, Stored>, collection: string, body: Stored): string | undefined => {
    const kind = COLLECTION_KINDS[collection];
    if (!kind || typeof body.key !== 'string' || typeof body.deleted !== 'boolean') return 'sc_invalid';
    if (body.id !== derivedId(account.id, kind, body.key) || body.user !== account.id) return 'sc_invalid';
    const at = `${collection}/${String(body.id)}`;
    const before = next.get(at);
    if ((collection === 'profiles' || collection === 'connections') && before?.deleted === true && body.deleted === false) return 'sc_deleted';
    if (collection === 'profiles' && !before && body.deleted === false) {
      const live = [...next.entries()].filter(([key, stored]) => key.startsWith('profiles/') && stored.deleted === false).length;
      if (live >= maxProfiles) return 'sc_limit';
    }
    let stored: Stored = { ...before, ...body, collectionName: collection };
    if (body.deleted === true) {
      stored = { id: body.id, user: body.user, key: body.key, deleted: true, collectionName: collection, ...parentsOf(body) };
    } else if (Array.isArray(body.secret_keys)) {
      // A password listed without its value keeps the stored one; one no longer listed goes.
      const sent = (body.secrets ?? {}) as Record<string, string>;
      const kept = (before?.secrets ?? {}) as Record<string, string>;
      const secrets: Record<string, string> = {};
      for (const name of body.secret_keys as string[]) {
        const value = sent[name] ?? kept[name];
        if (value !== undefined) secrets[name] = value;
      }
      stored.secrets = secrets;
    }
    next.set(at, stored);
    return undefined;
  };

  const routes: Record<string, Route> = {
    'GET /api/sc/info': () => json(200, { serverVersion: '0.2.0', maxProfiles, signUp: options.signUp ?? 'invite' }),
    'POST /api/sc/sign-up': (request) => {
      const body = bodyOf(request);
      if ((options.signUp ?? 'invite') === 'closed') return json(403, { message: 'closed' });
      if ((options.signUp ?? 'invite') === 'invite' && !invites.delete(String(body.invite))) return json(403, { message: 'invite' });
      const username = String(body.username ?? '');
      if (byName(username)) return json(400, { data: { username: { code: 'validation_not_unique', message: 'taken' } } });
      if (String(body.password ?? '').length < 8) return json(400, { data: { password: { code: 'validation_length_out_of_range', message: 'short' } } });
      const account = create(username, String(body.password));
      if (body.firstProfile === true) {
        const key = `first-${account.id}`;
        storeOf(account).set(`profiles/${derivedId(account.id, 'profile', key)}`, {
          id: derivedId(account.id, 'profile', key),
          user: account.id,
          key,
          deleted: false,
          name: username,
        });
      }
      return signedIn(account);
    },
    'POST /api/collections/users/auth-with-password': (request) => {
      if (throttled) return json(429, { message: 'too many' });
      const body = bodyOf(request);
      const account = byName(String(body.identity ?? ''));
      if (!account || account.password !== body.password) return json(400, { message: 'Failed to authenticate.' });
      return signedIn(account);
    },
    'POST /api/collections/users/auth-refresh': (request) => {
      const account = accountOf(request);
      return account ? signedIn(account) : json(401, { message: 'The request requires valid record authorization token.' });
    },
    'POST /api/batch': (request) => {
      const account = accountOf(request);
      if (!account) return json(401, { message: 'Sign in' });
      const requests = (bodyOf(request).requests ?? []) as { method: string; url: string; body: Stored }[];
      const next = new Map(storeOf(account));
      const results = [];
      for (const [index, item] of requests.entries()) {
        const collection = /^\/api\/collections\/([^/]+)\/records$/.exec(item.url)?.[1] ?? '';
        const code = item.method === 'PUT' ? judge(account, next, collection, item.body) : 'sc_invalid';
        if (code) {
          const field = code === 'sc_limit' ? 'user' : code === 'sc_deleted' ? 'deleted' : 'key';
          return json(400, {
            status: 400,
            message: 'Batch transaction failed.',
            data: { requests: { [String(index)]: { code: 'batch_request_failed', response: { status: 400, data: { [field]: { code, message: '…' } } } } } },
          });
        }
        results.push({ status: 200, body: item.body });
      }
      records.set(account.id, next);
      return json(200, results);
    },
  };
  for (const collection of Object.keys(COLLECTION_KINDS)) {
    routes[`GET /api/collections/${collection}/records`] = (request) => {
      const account = accountOf(request);
      if (!account) return json(401, { message: 'Sign in' });
      const all = [...storeOf(account).entries()]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .map(([, stored]) => stored)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const perPage = Number(request.query.perPage ?? 30);
      const page = Number(request.query.page ?? 1);
      return json(200, { page, perPage, items: all.slice((page - 1) * perPage, page * perPage) });
    };
  }

  const prefixed: Record<string, Route> = {};
  for (const [name, route] of Object.entries(routes)) {
    const space = name.indexOf(' ');
    const key = `${name.slice(0, space)} ${base}${name.slice(space + 1)}`;
    prefixed[key] = (request, calls) => {
      const override = overrides[name];
      if (override) return typeof override === 'function' ? override(request, calls) : override;
      return typeof route === 'function' ? route(request, calls) : route;
    };
  }
  const http = fakeHttp(prefixed);

  return {
    ...http,
    /** A test's own answer for a route, by its name without the base path. */
    override: (name: string, route: Route) => {
      overrides[name] = route;
    },
    addAccount: (username: string, password: string) => create(username, password),
    /** As the dashboard changes it: every session of the account ends. */
    changePassword: (username: string, password: string) => {
      const account = byName(username);
      if (!account) throw new Error(`no account ${username}`);
      account.password = password;
      for (const [token, id] of tokens) if (id === account.id) tokens.delete(token);
    },
    throttle: (on: boolean) => {
      throttled = on;
    },
    stored: (username: string) => {
      const account = byName(username);
      return account ? [...storeOf(account).values()] : [];
    },
    /** A record put there by hand, as another device wrote it. */
    put: (username: string, collection: string, body: Stored) => {
      const account = byName(username);
      if (!account) throw new Error(`no account ${username}`);
      storeOf(account).set(`${collection}/${String(body.id)}`, { ...body, collectionName: collection });
    },
  };
}

function parentsOf(body: Stored): Stored {
  return {
    ...(body.profile === undefined ? {} : { profile: body.profile }),
    ...(body.connection === undefined ? {} : { connection: body.connection }),
  };
}
