import { NativeModule, requireNativeModule } from 'expo';

declare class KeyDerivationModule extends NativeModule {
  /** PBKDF2-HMAC-SHA256 on the platform's own implementation: CommonCrypto on iOS, `javax.crypto` on Android. */
  pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, length: number): Promise<Uint8Array>;
}

export default requireNativeModule<KeyDerivationModule>('KeyDerivation');
