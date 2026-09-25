import type { Clock } from '@/services/ports';

export const systemClock: Clock = { now: () => Date.now() };
