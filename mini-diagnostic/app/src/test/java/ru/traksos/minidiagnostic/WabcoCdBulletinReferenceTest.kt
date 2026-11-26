package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class WabcoCdBulletinReferenceTest {
    @Test fun exactPreliminaryPairsOnly() {
        assertEquals(10,WabcoCdBulletinReference.count)
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_CD_BULLETIN,"77/03")!!
        assertEquals(r,WabcoCdBulletinReference.lookup("077/03"))
        assertFalse(r.exactPair)
        assertTrue(r.condition!!.startsWith("Предварительно"))
        assertTrue(WabcoCdBulletinReference.lookup("078/00")!!.component!!.contains("или"))
        for(code in listOf("076/12","077/11","077/12","078/11","246/14","077/05","077/3","00007703"))
            assertNull(WabcoCdBulletinReference.lookup(code))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E_OEM_EXACT,"077/03"))
        assertFalse(DisplayReferenceEdition.WABCO_CD_BULLETIN in ReferenceSelection.forTarget("zf-tebs-e"))
    }
}
