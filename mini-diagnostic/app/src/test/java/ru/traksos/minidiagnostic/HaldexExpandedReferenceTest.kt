package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class HaldexExpandedReferenceTest {
    @Test fun gen3ExpandedGroupsAndLongCodes() {
        assertEquals(55,HaldexExpandedReference.gen3Count)
        assertEquals(72,LegacyDisplayReference.haldexCount)
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"EPRV 22 HOLD SC DRIVE"))
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"TOWED CAN CONTROL LOSS"))
        assertNull(HaldexExpandedReference.gen3("BRK APPLY UNSPEC"))
        assertNull(HaldexExpandedReference.gen3("EPRV 23 HOLD SC"))
    }
    @Test fun gen2SeparateThresholdAndSpelling() {
        assertEquals(71,HaldexExpandedReference.gen2Count)
        assertTrue(HaldexExpandedReference.gen2("PWR LO VOLT")!!.second.contains("19 В"))
        assertTrue(HaldexExpandedReference.gen3("PWR LO VOLT")!!.second.contains("8 В"))
        assertNotNull(HaldexExpandedReference.gen2("PWR ISO7638 FAIL"))
        assertNull(HaldexExpandedReference.gen2("PWR ISO 7638 FAIL"))
        assertNull(HaldexExpandedReference.gen2("BRK APPLY OC"))
        assertNull(HaldexExpandedReference.gen2("BRK APPLY UNSPEC"))
        assertNull(HaldexExpandedReference.gen2("NO LINK"))
    }
}
