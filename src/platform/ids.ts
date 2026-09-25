import { randomUUID } from 'expo-crypto';

import type { IdGenerator } from '@/services/ports';

export const uuidGenerator: IdGenerator = { next: () => randomUUID() };
