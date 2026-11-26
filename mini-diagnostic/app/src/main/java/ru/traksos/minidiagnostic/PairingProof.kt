package ru.traksos.minidiagnostic

import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECKey
import java.security.spec.ECGenParameterSpec
import java.security.AlgorithmParameters
import java.security.spec.ECParameterSpec

// Research primitive only: NOT a BLE protocol, enrollment, license or session authorization.
// A trusted enrollment process and one-time challenge consumption must be implemented
// and independently reviewed on both endpoints before use.
enum class ProofRole(val marker:Byte) { PHONE(1), ADAPTER(2) }
object PairingProof {
    private val domain="TrakSOS-Mini/pairing-proof/research-v1".toByteArray(Charsets.US_ASCII)
    private val p256:ECParameterSpec by lazy {
        AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
    }
    private fun isP256(key:ECKey):Boolean {
        val p=key.params ?: return false
        return p.curve==p256.curve && p.generator==p256.generator &&
            p.order==p256.order && p.cofactor==p256.cofactor
    }
    fun fingerprint(key:PublicKey):ByteArray {
        require(key is ECKey && isP256(key))
        require(key.format=="X.509")
        return MessageDigest.getInstance("SHA-256").digest(key.encoded)
    }
    fun nonce():ByteArray=ByteArray(32).also { SecureRandom().nextBytes(it) }
    // Fixed-width fields; role separation prevents using a phone proof as an adapter proof.
    private fun transcript(role:ProofRole,phoneFingerprint:ByteArray,adapterFingerprint:ByteArray,
        phoneNonce:ByteArray,adapterNonce:ByteArray):ByteArray {
        require(listOf(phoneFingerprint,adapterFingerprint,phoneNonce,adapterNonce).all { it.size==32 })
        require(!phoneFingerprint.contentEquals(adapterFingerprint))
        require(!phoneNonce.contentEquals(adapterNonce))
        return domain+byteArrayOf(0,role.marker)+phoneFingerprint+adapterFingerprint+phoneNonce+adapterNonce
    }
    fun sign(key:PrivateKey,role:ProofRole,phoneFingerprint:ByteArray,adapterFingerprint:ByteArray,
        phoneNonce:ByteArray,adapterNonce:ByteArray):ByteArray {
        require(key is ECKey && isP256(key))
        val message=transcript(role,phoneFingerprint,adapterFingerprint,phoneNonce,adapterNonce)
        return Signature.getInstance("SHA256withECDSA").run { initSign(key); update(message); sign() }
    }
    fun verify(key:PublicKey,role:ProofRole,phoneFingerprint:ByteArray,adapterFingerprint:ByteArray,
        phoneNonce:ByteArray,adapterNonce:ByteArray,proof:ByteArray):Boolean {
        if(proof.size !in 8..80)return false
        return try {
            val claimed=if(role==ProofRole.PHONE)phoneFingerprint else adapterFingerprint
            if(!MessageDigest.isEqual(fingerprint(key),claimed))return false
            val message=transcript(role,phoneFingerprint,adapterFingerprint,phoneNonce,adapterNonce)
            Signature.getInstance("SHA256withECDSA").run { initVerify(key); update(message); verify(proof) }
        } catch(_:java.security.GeneralSecurityException) { false }
          catch(_:IllegalArgumentException) { false }
    }
}
