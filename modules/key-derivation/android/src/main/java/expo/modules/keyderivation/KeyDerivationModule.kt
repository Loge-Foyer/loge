package expo.modules.keyderivation

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// PBKDF2-HMAC-SHA256 on the platform's HMAC: plain JavaScript on Hermes runs it
// about a hundred times slower. Written out over the bytes it is given, because
// SecretKeyFactory would take the password as characters and re-encode it.
class KeyDerivationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeyDerivation")

    AsyncFunction("pbkdf2Sha256") { password: ByteArray, salt: ByteArray, iterations: Int, length: Int ->
      if (password.isEmpty() || iterations < 1 || length < 1) throw KeyDerivationException()
      pbkdf2Sha256(password, salt, iterations, length)
    }
  }
}

internal class KeyDerivationException : CodedException("The key could not be derived.")

internal fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int, length: Int): ByteArray {
  val mac = Mac.getInstance("HmacSHA256")
  mac.init(SecretKeySpec(password, "HmacSHA256"))
  val size = mac.macLength
  val derived = ByteArray(length)
  val u = ByteArray(size)
  val t = ByteArray(size)
  var block = 1
  var offset = 0
  while (offset < length) {
    mac.update(salt)
    mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
    mac.doFinal(u, 0)
    u.copyInto(t)
    for (round in 1 until iterations) {
      mac.update(u)
      mac.doFinal(u, 0)
      for (i in 0 until size) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
    }
    val take = minOf(size, length - offset)
    t.copyInto(derived, offset, 0, take)
    offset += take
    block += 1
  }
  return derived
}
