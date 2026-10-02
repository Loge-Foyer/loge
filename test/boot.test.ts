import { userId } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { decideInitialGate } from '@/services/boot';

const alex = { id: userId('alex'), name: 'Alex', pinProtected: true };
const kids = { id: userId('kids'), name: 'Kids', pinProtected: false };

describe('the launch decision', () => {
  it('asks for an account on a new device', () => {
    expect(decideInitialGate({ hasAccount: false, users: [], defaultUserId: undefined, alwaysChooseProfile: false }).gate).toEqual({ kind: 'needs-account' });
  });

  it('asks for a first profile on an account without one', () => {
    expect(decideInitialGate({ hasAccount: true, users: [], defaultUserId: undefined, alwaysChooseProfile: false }).gate).toEqual({ kind: 'needs-first-user' });
  });

  it('asks who is watching without a default', () => {
    expect(decideInitialGate({ hasAccount: true, users: [kids], defaultUserId: undefined, alwaysChooseProfile: false }).gate).toEqual({ kind: 'needs-user-selection' });
  });

  it('opens the default profile, or its PIN pad', () => {
    expect(decideInitialGate({ hasAccount: true, users: [kids, alex], defaultUserId: kids.id, alwaysChooseProfile: false }).gate).toEqual({ kind: 'ready', userId: kids.id });
    expect(decideInitialGate({ hasAccount: true, users: [kids, alex], defaultUserId: alex.id, alwaysChooseProfile: false }).gate).toEqual({
      kind: 'needs-user-unlock',
      userId: alex.id,
    });
  });

  it('asks who is watching every time on a device that always asks, default or not', () => {
    expect(decideInitialGate({ hasAccount: true, users: [kids, alex], defaultUserId: kids.id, alwaysChooseProfile: true })).toEqual({
      gate: { kind: 'needs-user-selection' },
      clearDefaultUser: false,
    });
  });

  it('still clears a vanished default on a device that always asks', () => {
    expect(decideInitialGate({ hasAccount: true, users: [kids], defaultUserId: userId('gone'), alwaysChooseProfile: true })).toEqual({
      gate: { kind: 'needs-user-selection' },
      clearDefaultUser: true,
    });
  });

  it('clears a default that no longer exists', () => {
    expect(decideInitialGate({ hasAccount: true, users: [kids], defaultUserId: userId('gone'), alwaysChooseProfile: false })).toEqual({
      gate: { kind: 'needs-user-selection' },
      clearDefaultUser: true,
    });
  });
});
