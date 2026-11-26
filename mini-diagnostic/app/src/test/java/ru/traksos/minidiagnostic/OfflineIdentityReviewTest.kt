package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class OfflineIdentityReviewTest {
    private fun part(value:String)="F187: 62 F1 87 "+value.toByteArray(Charsets.US_ASCII).joinToString(" ") { OfflineCaptureReview.hexByte(it.toInt() and 255) }
    @Test fun exactCatalogHintAndRawEvidence() {
        val text=part("4801023020")+"\nF189: 62 F1 89 30 31\nF18A: 7F 22 31"
        val r=OfflineIdentityReview.parse(text,false) as OfflineIdentityResult.Accepted
        assertEquals(listOf("zf-iebs"),r.catalogCandidates)
        assertEquals(2,r.observed.size)
        assertEquals(3,r.rows.size)
        assertEquals(text,r.originalText)
        assertEquals(64,r.sha256.length)
        assertTrue(OfflineIdentityReview.reportText(r).contains("НЕ подтверждена"))
        assertTrue((OfflineIdentityReview.parse(text,true) as OfflineIdentityResult.Accepted).catalogCandidates.isEmpty())
    }
    @Test fun sharedNumberAndNoGuessing() {
        val shared=OfflineIdentityReview.parse(part("810011001"),false) as OfflineIdentityResult.Accepted
        assertEquals(setOf("haldex-eb1","haldex-eb2"),shared.catalogCandidates.toSet())
        for(p in listOf("4461050010","4801023040","4801023020 ","X4801023020","4801023020\u0000","4801023020X","480--1023020")) {
            assertTrue(p,(OfflineIdentityReview.parse(part(p),false) as OfflineIdentityResult.Accepted).catalogCandidates.isEmpty())
        }
        assertNull(OfflineIdentityReview.printableAscii("0031"))
    }
    @Test fun modernPartDidHintsNeverChooseAmbiguousVariant() {
        for((label,expected) in mapOf(
            "K211212" to setOf("kb-itebs-x"),
            "K211212V01N49" to setOf("kb-itebs-x"),
            "K267862" to setOf("kb-itebs-x"),
            "35503100090" to setOf("sorl-trailer-abs"),
            "35682030050" to setOf("sorl-research"),
            "4801020630" to setOf("vie-tebs","vie-tebs-subsystem","zf-tebs-e")
        )) {
            val actual=OfflineIdentityReview.parse(part(label),false) as OfflineIdentityResult.Accepted
            assertEquals(label,expected,actual.catalogCandidates.toSet())
            assertTrue((OfflineIdentityReview.parse(part(label),true) as OfflineIdentityResult.Accepted).catalogCandidates.isEmpty())
        }
        for(label in listOf("ES2031","k211212"," K211212","K211212 ","K211212V01","K211214",
            "35682030020","35503100090 ","480--1020630","K211212V01N49X")) {
            assertTrue(label,(OfflineIdentityReview.parse(part(label),false) as OfflineIdentityResult.Accepted).catalogCandidates.isEmpty())
        }
    }
    @Test fun rejectInvalidOrConflictingData() {
        fun reason(input:String)=(OfflineIdentityReview.parse(input,false) as OfflineIdentityResult.Rejected).reason
        assertEquals("CONFLICTING_IDENTITY",reason(part("810011001")+"\n"+part("810003101")))
        assertEquals("UNEXPECTED_DID",reason("F187: 62 F1 89 31"))
        assertEquals("UNKNOWN_DID",reason("FFFF: 62 FF FF 31"))
        assertEquals("NEGATIVE_FORMAT",reason("F187: 7F 19 31"))
        assertEquals("EMPTY_VALUE",reason("F187: 62 F1 87"))
        assertEquals("INVALID_HEX",reason("F187: 62 F187 31"))
        assertEquals("INPUT_TOO_LONG",reason("A".repeat(32769)))
        assertEquals("ROW_COUNT",reason(List(65){part("810011001")}.joinToString("\n")))
    }
}
