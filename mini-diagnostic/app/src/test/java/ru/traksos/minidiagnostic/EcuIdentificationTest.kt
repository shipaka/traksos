package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test
class EcuIdentificationTest {
    private val scope=IdentityCaptureScope("synthetic-capture","synthetic-peer",ElectricalPath.ISO11898)
    private val fields=mapOf(IdentityDid.SUPPLIER to "AA",IdentityDid.PART to "0102",
        IdentityDid.HW to "33",IdentityDid.SW to "44")
    private val signature=IdentitySignature("synthetic-ecu",scope.path,fields,"synthetic test only")
    private fun observations()=fields.map { (did,raw)-> IdentityObservation(scope,IdentityReply.Value(did,raw)) }
    @Test fun parseOnlyExpectedDidAndPreserveBinary() {
        assertEquals(IdentityReply.Value(IdentityDid.SUPPLIER,"FF0080"),
            UdsIdentityDecoder.decode(IdentityDid.SUPPLIER,byteArrayOf(0x62,0xF1.toByte(),0x8A.toByte(),0xFF.toByte(),0,0x80.toByte())))
        assertEquals(IdentityReply.Negative(0x31),UdsIdentityDecoder.decode(IdentityDid.PART,byteArrayOf(0x7F,0x22,0x31)))
        assertTrue(UdsIdentityDecoder.decode(IdentityDid.PART,byteArrayOf(0x62,0xF1.toByte(),0x8A.toByte(),0)) is IdentityReply.Rejected)
        assertTrue(UdsIdentityDecoder.decode(IdentityDid.PART,byteArrayOf(0x62,0xF1.toByte(),0x87.toByte())) is IdentityReply.Rejected)
    }
    @Test fun exactMatchOnlyNoProductionClaims() {
        val obs=observations()
        assertTrue(EcuIdentityResolver().resolve(scope,obs) is IdentityResolution.Unknown)
        val resolver=EcuIdentityResolver(listOf(signature))
        assertEquals(IdentityResolution.ReferenceMatch("synthetic-ecu","synthetic test only"),resolver.resolve(scope,obs))
        assertTrue(resolver.resolve(scope,obs.dropLast(1)) is IdentityResolution.Unknown)
        assertTrue(resolver.resolve(scope,obs+IdentityObservation(scope,IdentityReply.Value(IdentityDid.PART,"99"))) is IdentityResolution.Rejected)
        assertTrue(resolver.resolve(scope,obs+IdentityObservation(scope.copy(peerId="other"),obs.first().reply)) is IdentityResolution.Rejected)
        assertTrue(EcuIdentityResolver(listOf(signature,signature.copy(targetId="other",required=fields+(IdentityDid.SUPPLIER_HW_VERSION to "55")))).resolve(scope,obs) is IdentityResolution.Ambiguous)
        val wrongPath=scope.copy(path=ElectricalPath.ISO11992)
        assertTrue(resolver.resolve(wrongPath,obs.map { it.copy(scope=wrongPath) }) is IdentityResolution.Unknown)
    }
    @Test(expected=IllegalArgumentException::class)
    fun supplierOnlyCannotIdentifyModel() {
        EcuIdentityResolver(listOf(signature.copy(required=mapOf(IdentityDid.SUPPLIER to "AA"))))
    }
}
