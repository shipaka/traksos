package ru.traksos.minidiagnostic

import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import org.junit.Assert.*
import org.junit.Test

class PairingProofTest {
    private fun pair(curve:String="secp256r1")=KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec(curve))
    }.generateKeyPair()
    @Test fun proofBindsRoleBothKeysAndBothChallenges() {
        val phone=pair(); val adapter=pair(); val other=pair()
        val p=PairingProof.fingerprint(phone.public); val a=PairingProof.fingerprint(adapter.public)
        val pn=PairingProof.nonce(); val an=PairingProof.nonce()
        val proof=PairingProof.sign(phone.private,ProofRole.PHONE,p,a,pn,an)
        assertTrue(PairingProof.verify(phone.public,ProofRole.PHONE,p,a,pn,an,proof))
        assertFalse(PairingProof.verify(other.public,ProofRole.PHONE,p,a,pn,an,proof))
        assertFalse(PairingProof.verify(phone.public,ProofRole.ADAPTER,p,a,pn,an,proof))
        assertFalse(PairingProof.verify(phone.public,ProofRole.PHONE,p,PairingProof.fingerprint(other.public),pn,an,proof))
        assertFalse(PairingProof.verify(phone.public,ProofRole.PHONE,p,a,PairingProof.nonce(),an,proof))
        assertFalse(PairingProof.verify(phone.public,ProofRole.PHONE,p,a,pn,PairingProof.nonce(),proof))
        assertFalse(PairingProof.verify(phone.public,ProofRole.PHONE,p,a,pn,pn,proof))
        assertFalse(PairingProof.verify(phone.public,ProofRole.PHONE,p,a,pn,an,ByteArray(81)))
        assertFalse(PairingProof.verify(phone.public,ProofRole.PHONE,p,a,pn,an,ByteArray(12)))
        // This primitive alone accepts the same valid transcript repeatedly.
        // Fresh single-use challenges are a separate mandatory endpoint responsibility.
        assertTrue(PairingProof.verify(phone.public,ProofRole.PHONE,p,a,pn,an,proof))
    }
    @Test fun rejectsInvalidCurveAndFieldLengths() {
        val phone=pair();val adapter=pair()
        val p=PairingProof.fingerprint(phone.public);val a=PairingProof.fingerprint(adapter.public)
        val pn=PairingProof.nonce();val an=PairingProof.nonce()
        val proof=PairingProof.sign(adapter.private,ProofRole.ADAPTER,p,a,pn,an)
        assertTrue(PairingProof.verify(adapter.public,ProofRole.ADAPTER,p,a,pn,an,proof))
        assertFalse(PairingProof.verify(adapter.public,ProofRole.ADAPTER,p,a,ByteArray(31),an,proof))
        assertFalse(PairingProof.verify(pair("secp384r1").public,ProofRole.ADAPTER,p,a,pn,an,proof))
        assertFalse(PairingProof.verify(adapter.public,ProofRole.ADAPTER,a,a,pn,an,proof))
    }
}
