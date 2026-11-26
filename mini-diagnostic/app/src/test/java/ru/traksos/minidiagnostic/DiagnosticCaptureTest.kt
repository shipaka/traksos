package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class DiagnosticCaptureTest {
    private val ecu = EcuIdentity(EcuFamily.WABCO_TEBS_E,"TEST-PART","TEST-SW")
    private fun meta(time:Long=1,origin:CaptureOrigin=CaptureOrigin.MANUAL_BENCH_IMPORT,
        identity:EcuIdentity?=ecu,filter:Int?=0x49) = CaptureMetadata(origin,identity,time,filter)
    private val capture = DiagnosticCapture()

    @Test fun importsAndPreservesBytesWithoutInventingDescription() {
        val r = capture.importHex(meta(),"59 02 49 ab cd ef 09") as CaptureResult.Report
        assertEquals("590249ABCDEF09",r.rawPduHex)
        assertEquals("ABCDEF",r.records.single().raw.code)
        assertEquals(DtcStatus.ACTIVE,r.records.single().raw.status)
        assertNull(r.records.single().descriptionRu)
        assertNull(r.profileId)
    }
    @Test fun rejectsMalformedTextAndPreservesNegativeResponse() {
        listOf("","590","0x590249","59 0249","59:02:49","59 02 GG","59 02 49 FF","A".repeat(16385))
            .forEach { assertTrue(it.take(20),capture.importHex(meta(),it) is CaptureResult.Rejected) }
        assertEquals(0x78,(capture.importHex(meta(),"7F 19 78") as CaptureResult.Negative).reason)
    }
    @Test fun exactIdentityRequiredForMappingAndSyntheticNeverMapped() {
        val registry = ProfileRegistry(listOf(ProfileEvidence(ecu,"fixture","test evidence")))
        val catalog = DtcCatalog(listOf(DtcDefinition(ecu.family,"fixture","ABCDEF","fixture only","test source")))
        val c = DiagnosticCapture(registry,catalog)
        fun description(m:CaptureMetadata) = (c.importHex(m,"590249ABCDEF09") as CaptureResult.Report).records.single().descriptionRu
        assertEquals("fixture only",description(meta()))
        assertNull(description(meta(identity=ecu.copy(softwareVersion="other"))))
        assertNull(description(meta(identity=ecu.copy(softwareVersion=null))))
        assertNull(description(meta(origin=CaptureOrigin.SYNTHETIC)))
    }
    @Test fun compareTracksObservedRecordsRatherThanRepair() {
        val a = capture.importHex(meta(),"590249ABCDEF090000010800000209")
        val b = capture.importHex(meta(2),"590249ABCDEF080000020900000309")
        val r = DiagnosticComparison.compare(a,b,true) as CaptureComparison.Compared
        assertEquals(setOf("000001"),r.onlyBefore)
        assertEquals(setOf("000003"),r.onlyAfter)
        assertEquals(setOf("ABCDEF"),r.statusChanged)
        assertEquals(setOf("000002"),r.unchanged)
    }
    @Test fun compareRejectsIncompatibleOrIncompleteCaptures() {
        val a = capture.importHex(meta(),"590249ABCDEF09")
        val b = capture.importHex(meta(2),"590249")
        assertTrue(DiagnosticComparison.compare(a,b,false) is CaptureComparison.NotComparable)
        assertTrue(DiagnosticComparison.compare(b,a,true) is CaptureComparison.NotComparable)
        assertTrue(DiagnosticComparison.compare(a,capture.importHex(meta(2,filter=null),"590249"),true) is CaptureComparison.NotComparable)
        assertTrue(DiagnosticComparison.compare(a,capture.importHex(meta(2),"5902FF"),true) is CaptureComparison.NotComparable)
        assertTrue(DiagnosticComparison.compare(a,capture.importHex(meta(2),"7F1978"),true) is CaptureComparison.NotComparable)
        assertTrue(DiagnosticComparison.compare(a,capture.importHex(meta(2,origin=CaptureOrigin.SYNTHETIC),"590249"),true) is CaptureComparison.NotComparable)
    }
}
