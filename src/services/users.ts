import type { AppUser } from '@loge/api';

import { effectivePinRef } from './device-pins';
import type { DeviceSettings, StoredUser } from './ports';

/**
 * A profile as the screens see it. `pinProtected` is whether this device asks
 * for its PIN: what the device decided for it, else what the account keeps —
 * so `pins` is never left out.
 */
export function toAppUser(user: StoredUser, pins: DeviceSettings['pins']): AppUser {
  return { id: user.id, name: user.name, pinProtected: effectivePinRef(user, pins) !== undefined };
}
