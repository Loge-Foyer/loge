import { AppError, isAppError, isTransportError, TransportError } from '@sc/api';
import { describe, expect, it } from 'vitest';

describe('AppError', () => {
  it('gives each code a retry hint that fits it', () => {
    expect(new AppError('UNAUTHORIZED', 'Wrong password').retry).toBe('never');
    expect(new AppError('OFFLINE', 'No network').retry).toBe('network-change');
    expect(new AppError('PROVIDER_UNAVAILABLE', 'Starting up').retry).toBe('backoff');
  });

  it('keeps an explicit hint, a reason and a cause', () => {
    const cause = new TransportError('timeout');
    const error = new AppError('TIMEOUT', 'Too slow', { retry: 'network-change', reason: 'local-network-only', cause });
    expect(error).toMatchObject({ code: 'TIMEOUT', retry: 'network-change', reason: 'local-network-only' });
    expect(error.cause).toBe(cause);
    expect(isAppError(error)).toBe(true);
    expect(isTransportError(cause)).toBe(true);
    expect(isAppError(cause)).toBe(false);
  });
});
