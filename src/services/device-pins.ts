import type { CredentialsRef, UserId } from '@loge/api';

import type { DevicePin, DeviceSettings, StoredUser } from './ports';

/** What this device decided for a profile's PIN, if anything: an own key only, so no id is found on Object's prototype. */
export function devicePinOf(pins: DeviceSettings['pins'], userId: UserId): DevicePin | undefined {
  return pins !== undefined && Object.prototype.hasOwnProperty.call(pins, userId) ? pins[userId] : undefined;
}

/** The PIN this device asks for: its own decision, else the account's. */
export function effectivePinRef(user: StoredUser, pins: DeviceSettings['pins']): CredentialsRef | undefined {
  const own = devicePinOf(pins, user.id);
  return own ? own.ref : user.pinCredentialRef;
}

/** This device deciding a profile's PIN: `{}` for none, whatever the account says. */
export function withDevicePin(settings: DeviceSettings, userId: UserId, pin: DevicePin): DeviceSettings {
  return { ...settings, pins: { ...settings.pins, [userId]: pin } };
}

/** The account's PIN again. Nothing decided is no key at all, so its row goes. */
export function withoutDevicePin(settings: DeviceSettings, userId: UserId): DeviceSettings {
  if (devicePinOf(settings.pins, userId) === undefined) return settings;
  const { [userId]: _gone, ...rest } = settings.pins ?? {};
  if (Object.keys(rest).length > 0) return { ...settings, pins: rest };
  const { pins: _none, ...without } = settings;
  return without;
}
