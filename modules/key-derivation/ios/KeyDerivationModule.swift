import CommonCrypto
import ExpoModulesCore

// PBKDF2-HMAC-SHA256 on the platform's own implementation: plain JavaScript on
// Hermes runs it about a hundred times slower, too slow for any iteration
// count worth having.
public class KeyDerivationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyDerivation")

    AsyncFunction("pbkdf2Sha256") { (password: Data, salt: Data, iterations: Int, length: Int) throws -> Data in
      guard !password.isEmpty, iterations > 0, length > 0 else { throw KeyDerivationException() }
      var derived = Data(count: length)
      let status = derived.withUnsafeMutableBytes { derivedBytes in
        password.withUnsafeBytes { passwordBytes in
          salt.withUnsafeBytes { saltBytes in
            CCKeyDerivationPBKDF(
              CCPBKDFAlgorithm(kCCPBKDF2),
              passwordBytes.baseAddress?.assumingMemoryBound(to: CChar.self),
              password.count,
              saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
              salt.count,
              CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
              UInt32(iterations),
              derivedBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
              length
            )
          }
        }
      }
      guard status == kCCSuccess else { throw KeyDerivationException() }
      return derived
    }
  }
}

internal final class KeyDerivationException: Exception {
  override var reason: String {
    "The key could not be derived."
  }
}
