import type { AppUser } from '@loge/api';

import type { StoredUser } from './ports';

export function toAppUser({ id, name, pinCredentialRef }: StoredUser): AppUser {
  return { id, name, pinProtected: pinCredentialRef !== undefined };
}
