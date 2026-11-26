package ru.traksos.minidiagnostic

import java.security.PublicKey
import java.security.MessageDigest

// Offline research verifier. NOT an authenticated transport, enrollment, or
// authorization token. The caller must supply the pinned key of the peer,
// never a public key just received from an untrusted connection.
// One verifier per connection; close it on disconnect. No production callers.
class OneShotPairingReview(
    private val peerKey:PublicKey,
    private val peerRole:ProofRole,
    localKey:PublicKey,
    private val monotonicMillis:()->Long
) {
    companion object {
        const val TTL_MILLIS=10_000L // research policy, not BLE timing specification
    }
    private val peerFingerprint=PairingProof.fingerprint(peerKey)
    private val localFingerprint=PairingProof.fingerprint(localKey)
    init { require(!MessageDigest.isEqual(peerFingerprint,localFingerprint)) }

    private data class Pending(val local:ByteArray,val remote:ByteArray,val issued:Long)
    private var pending:Pending?=null
    private var closed=false
    enum class Result { MATCHED_RESEARCH_ONLY, NO_PENDING, EXPIRED, INVALID_PROOF, CLOSED }

    // Every start invalidates an older pending challenge, even if the new
    // request is invalid. Fresh local randomness is generated internally.
    @Synchronized fun start(remoteNonce:ByteArray):ByteArray? {
        pending=null
        if(closed || remoteNonce.size!=32)return null
        val issued=monotonicMillis()
        if(issued<0)return null
        val remote=remoteNonce.copyOf()
        val local=PairingProof.nonce()
        if(MessageDigest.isEqual(local,remote))return null
        pending=Pending(local,remote,issued)
        return local.copyOf()
    }
    @Synchronized fun check(proof:ByteArray):Result {
        if(closed)return Result.CLOSED
        val p=pending ?: return Result.NO_PENDING
        pending=null // consume before checking time, signature or any input
        val now=monotonicMillis()
        if(now<p.issued || now-p.issued>=TTL_MILLIS)return Result.EXPIRED
        val phone=if(peerRole==ProofRole.PHONE)peerFingerprint else localFingerprint
        val adapter=if(peerRole==ProofRole.ADAPTER)peerFingerprint else localFingerprint
        val phoneNonce=if(peerRole==ProofRole.PHONE)p.remote else p.local
        val adapterNonce=if(peerRole==ProofRole.ADAPTER)p.remote else p.local
        return if(PairingProof.verify(peerKey,peerRole,phone,adapter,phoneNonce,adapterNonce,proof.copyOf()))
            Result.MATCHED_RESEARCH_ONLY else Result.INVALID_PROOF
    }
    @Synchronized fun close() {
        pending=null
        closed=true
    }
}
