import {
  isSyncChange,
  syncCursor,
  userId,
  type ConnectedUserStateSyncProvider,
  type PluginContext,
  type PluginTarget,
  type SyncChange,
} from '@sc/api';

const PAGE_SIZE = 50;
const SLOW_MS = 1_500;
const DEFAULT_ENDPOINT = 'mock://account';
const HOUSEHOLD = 'mock://household';

interface PretendAccount {
  /** Changes with every reload, so a cursor from before one is answered with `reset`. */
  readonly epoch: string;
  readonly log: SyncChange[];
  readonly stored: Set<string>;
}

// Every connection in this runtime with the same endpoint shares one pretend
// account. It lasts as long as the runtime: a reload forgets it, which is how
// the app's `reset` path gets exercised.
const accounts = new Map<string, PretendAccount>();
let created = 0;

function accountAt(endpoint: string, now: number): PretendAccount {
  const existing = accounts.get(endpoint);
  if (existing) return existing;
  created += 1;
  const seed = endpoint === HOUSEHOLD ? householdSeed() : [];
  const account = { epoch: `${now.toString(36)}-${created}`, log: [...seed], stored: new Set(seed.map((change) => change.id)) };
  accounts.set(endpoint, account);
  return account;
}

/** A household that already has profiles — one with a PIN — so "profiles arrive" can be tried in the app. */
function householdSeed(): readonly SyncChange[] {
  const sam = userId('household-sam');
  const robin = userId('household-robin');
  return [
    { id: 'household:1', changedAt: 0, entity: 'profile', operation: 'upsert', data: { userId: sam, name: 'Sam' } },
    { id: 'household:2', changedAt: 0, entity: 'pin', operation: 'upsert', data: { userId: sam, pin: '1234' } },
    { id: 'household:3', changedAt: 0, entity: 'profile', operation: 'upsert', data: { userId: robin, name: 'Robin' } },
  ];
}

function positionIn(account: PretendAccount, cursor: string): number | undefined {
  const dot = cursor.lastIndexOf('.');
  if (cursor.slice(0, dot) !== account.epoch) return undefined;
  const position = Number(cursor.slice(dot + 1));
  return Number.isInteger(position) && position >= 0 && position <= account.log.length ? position : undefined;
}

export function createSyncProvider(target: PluginTarget, context: PluginContext): ConnectedUserStateSyncProvider {
  const { connectionId, fields, settings } = target;
  const endpoint = typeof fields.endpoint === 'string' && fields.endpoint.trim() !== '' ? fields.endpoint.trim() : DEFAULT_ENDPOINT;
  let pushes = 0;

  const respond = async <T>(answer: () => T): Promise<T> => {
    if (settings.latency === 'slow') await context.clock.sleep(SLOW_MS);
    return answer();
  };
  const account = () => accountAt(endpoint, context.clock.now());

  return {
    connectionId,

    getStatus: () => respond(() => ({ accountName: endpoint })),

    pull: (cursor) =>
      respond(() => {
        const current = account();
        const from = cursor === undefined ? 0 : positionIn(current, cursor);
        if (from === undefined) return { kind: 'reset' as const };
        const changes = current.log.slice(from, from + PAGE_SIZE);
        const next = from + changes.length;
        return { kind: 'changes' as const, changes, cursor: syncCursor(`${current.epoch}.${next}`), more: next < current.log.length };
      }),

    push: (changes) =>
      respond(() => {
        const current = account();
        pushes += 1;
        // Flaky: every third push stores half the batch — what a server that fails half-way answers.
        const limit = settings.latency === 'flaky' && pushes % 3 === 0 ? Math.floor(changes.length / 2) : changes.length;
        const accepted: string[] = [];
        for (const change of changes.slice(0, limit)) {
          if (!isSyncChange(change)) break;
          if (!current.stored.has(change.id)) {
            current.stored.add(change.id);
            // Stored as a server would store it: as JSON, never as the caller's object.
            current.log.push(JSON.parse(JSON.stringify(change)) as SyncChange);
          }
          accepted.push(change.id);
        }
        return { accepted };
      }),

    // A pretend account has no owner to ask.
    verifyOwner: () => respond(() => undefined),

    dispose: async () => {},
  };
}
