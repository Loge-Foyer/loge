// VLC's engine reaches its Expo module through expo, which needs the native
// runtime Node does not have. The tests read VLC's manifest and never play:
// a player made here fails loudly.
export class SharedObject {}

export function requireNativeModule(name: string): never {
  throw new Error(`${name} has no native module in the tests.`);
}

export function requireNativeView(): () => null {
  return () => null;
}
