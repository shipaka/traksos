package ru.traksos.minidiagnostic

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.ECGenParameterSpec

// Non-exportable Android Keystore signing key; no universal embedded secret.
// Research foundation only. No callers from BLE or public Android components.
// Device-dependent hardware backing is not guaranteed.
object PhonePairingKey {
    private const val ALIAS="traksos.mini.phone-pairing.research.v1"
    private fun store()=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    @Synchronized fun publicKeyOrCreate():PublicKey {
        val ks=store()
        if(!ks.containsAlias(ALIAS)) {
            val generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore")
            generator.initialize(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false)
                .build())
            generator.generateKeyPair()
        }
        // Never regenerate silently on an existing unusable alias.
        return store().getCertificate(ALIAS)?.publicKey ?: error("PAIRING_KEY_UNAVAILABLE")
    }
    @Synchronized fun signResearchProof(expectedPhoneFingerprint:ByteArray,adapterFingerprint:ByteArray,
        phoneNonce:ByteArray,adapterNonce:ByteArray):ByteArray {
        val ks=store()
        val pub=ks.getCertificate(ALIAS)?.publicKey ?: error("PAIRING_KEY_UNAVAILABLE")
        require(java.security.MessageDigest.isEqual(PairingProof.fingerprint(pub),expectedPhoneFingerprint))
        val key=ks.getKey(ALIAS,null) as? PrivateKey ?: error("PAIRING_KEY_UNAVAILABLE")
        return PairingProof.sign(key,ProofRole.PHONE,expectedPhoneFingerprint,adapterFingerprint,phoneNonce,adapterNonce)
    }
    // A future physical re-enrollment flow must separately revoke old adapter trust.
    // No automatic deletion or key export is provided here.
}
