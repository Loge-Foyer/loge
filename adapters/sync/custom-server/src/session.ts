/**
 * What the plugin keeps in its session, in the device-bound store: PocketBase's
 * token and the account it names. Or a latch: a sign-in with the saved
 * password was refused, and nothing signs in again until the user does — a
 * new password gives the connection a new session anyway.
 */
export type Session =
  | { readonly kind: 'live'; readonly token: string; readonly accountId: string; readonly username: string }
  | { readonly kind: 'refused' };

export type LiveSession = Extract<Session, { kind: 'live' }>;

// Phase 4's sessions were version 1: they read as none, and the plugin signs in afresh.
const VERSION = 2;

export function encodeSession(session: Session): string {
  return JSON.stringify(
    session.kind === 'refused'
      ? { v: VERSION, refused: true }
      : { v: VERSION, token: session.token, accountId: session.accountId, username: session.username },
  );
}

/** `undefined` for no session, or one this plugin did not write: it signs in again. */
export function decodeSession(raw: string | undefined): Session | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { v, refused, token, accountId, username } = value as Readonly<Record<string, unknown>>;
  if (v !== VERSION) return undefined;
  if (refused === true) return { kind: 'refused' };
  if (typeof token !== 'string' || token === '' || typeof accountId !== 'string' || typeof username !== 'string') return undefined;
  return { kind: 'live', token, accountId, username };
}
