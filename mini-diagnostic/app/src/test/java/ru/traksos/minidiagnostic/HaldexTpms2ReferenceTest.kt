package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class HaldexTpms2ReferenceTest {
    @Test fun onlyObservedReceiverDisplayCodes() {
        assertEquals(4,HaldexTpms2Reference.count)
        for(code in listOf("F002","F000","A1002","A1001")) {
            val r=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_TPMS2,code)!!
            assertFalse(r.exactPair)
            assertTrue(r.source!!.endsWith("#page=55"))
            assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE,code))
        }
        assertTrue(HaldexTpms2Reference.lookup("F000")!!.condition!!.contains("Критически"))
        for(code in listOf("F001","A1003","0xF002","External TPMS")) assertNull(HaldexTpms2Reference.lookup(code))
        assertEquals(HaldexTpms2Reference.lookup("f002"),HaldexTpms2Reference.lookup("F002"))
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.HALDEX_TPMS2 in ReferenceSelection.forTarget(it.id) })
    }
}
