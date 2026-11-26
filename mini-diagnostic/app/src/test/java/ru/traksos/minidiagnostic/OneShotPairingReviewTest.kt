package ru.traksos.minidiagnostic

import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import org.junit.Assert.*
import org.junit.Test

class OneShotPairingReviewTest {
    private fun pair()=KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()
    private val phone=pair()
    private val adapter=pair()
    private val phoneFp=PairingProof.fingerprint(phone.public)
    private val adapterFp=PairingProof.fingerprint(adapter.public)
    private var now=100L
    private fun reviewer()=OneShotPairingReview(phone.public,ProofRole.PHONE,adapter.public){now}
    private fun sign(remote:ByteArray,local:ByteArray)=
        PairingProof.sign(phone.private,ProofRole.PHONE,phoneFp,adapterFp,remote,local)

    @Test fun oneAttemptThenReplayRejected() {
        val r=reviewer()
        val remote=PairingProof.nonce()
        val local=r.start(remote)!!
        val proof=sign(remote,local)
        assertEquals(OneShotPairingReview.Result.MATCHED_RESEARCH_ONLY,r.check(proof))
        assertEquals(OneShotPairingReview.Result.NO_PENDING,r.check(proof))
        r.start(remote)!!
        assertEquals(OneShotPairingReview.Result.INVALID_PROOF,r.check(proof))
        assertEquals(OneShotPairingReview.Result.NO_PENDING,r.check(proof))
    }
    @Test fun failureConsumesChallengeAndExpiryIsStrict() {
        val r=reviewer(); val remote=PairingProof.nonce()
        val local=r.start(remote)!!
        val proof=sign(remote,local)
        assertEquals(OneShotPairingReview.Result.INVALID_PROOF,r.check(ByteArray(4)))
        assertEquals(OneShotPairingReview.Result.NO_PENDING,r.check(proof))
        val fresh=sign(remote,r.start(remote)!!)
        now+=OneShotPairingReview.TTL_MILLIS
        assertEquals(OneShotPairingReview.Result.EXPIRED,r.check(fresh))
        assertEquals(OneShotPairingReview.Result.NO_PENDING,r.check(fresh))
        val next=sign(remote,r.start(remote)!!)
        now--
        assertEquals(OneShotPairingReview.Result.EXPIRED,r.check(next))
    }
    @Test fun inputCopiesReplacementAndDisconnect() {
        val r=reviewer(); val remote=PairingProof.nonce()
        val orig=remote.copyOf(); val local=r.start(remote)!!
        val proof=sign(orig,local.copyOf())
        remote.fill(0); local.fill(0)
        assertEquals(OneShotPairingReview.Result.MATCHED_RESEARCH_ONLY,r.check(proof))
        val stale=sign(orig,r.start(orig)!!)
        assertNull(r.start(ByteArray(1)))
        assertEquals(OneShotPairingReview.Result.NO_PENDING,r.check(stale))
        r.start(orig)
        r.close()
        assertNull(r.start(orig))
        assertEquals(OneShotPairingReview.Result.CLOSED,r.check(stale))
    }
    @Test fun reverseRoleAndWrongKey() {
        val r=OneShotPairingReview(adapter.public,ProofRole.ADAPTER,phone.public){now}
        val remote=PairingProof.nonce()
        val local=r.start(remote)!!
        val valid=PairingProof.sign(adapter.private,ProofRole.ADAPTER,phoneFp,adapterFp,local,remote)
        assertEquals(OneShotPairingReview.Result.MATCHED_RESEARCH_ONLY,r.check(valid))
        val next=r.start(remote)!!
        val wrong=PairingProof.sign(pair().private,ProofRole.ADAPTER,phoneFp,adapterFp,next,remote)
        assertEquals(OneShotPairingReview.Result.INVALID_PROOF,r.check(wrong))
    }
}
