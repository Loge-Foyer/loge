import { userId } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { decideInitialGate } from '@/services/boot';

const alex = { id: userId('alex'), name: 'Alex', pinProtected: true };
const kids = { id: userId('kids'), name: 'Kids', pinProtected: false };

describe('the launch decision', () => {
  it('asks for a first profile on a new device', () => {
    expect(decideInitialGate({ users: [], defaultUserId: undefined }).gate).toEqual({ kind: 'needs-first-user' });
  });

  it('asks who is watching without a default', () => {
    expect(decideInitialGate({ users: [kids], defaultUserId: undefined }).gate).toEqual({ kind: 'needs-user-selection' });
  });

  it('opens the default profile, or its PIN pad', () => {
    expect(decideInitialGate({ users: [kids, alex], defaultUserId: kids.id }).gate).toEqual({ kind: 'ready', userId: kids.id });
    expect(decideInitialGate({ users: [kids, alex], defaultUserId: alex.id }).gate).toEqual({ kind: 'needs-user-unlock', userId: alex.id });
  });

  it('clears a default that no longer exists', () => {
    expect(decideInitialGate({ users: [kids], defaultUserId: userId('gone') })).toEqual({
      gate: { kind: 'needs-user-selection' },
      clearDefaultUser: true,
    });
  });
});
