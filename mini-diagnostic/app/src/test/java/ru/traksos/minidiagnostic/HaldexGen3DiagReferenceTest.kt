package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class HaldexGen3DiagReferenceTest {
    @Test fun groupedAliasesDoNotInventWheelOrChannel() {
        assertEquals(17,HaldexGen3DiagReference.aliasCount)
        assertEquals(4,HaldexGen3DiagReference.count)
        val wheel=HaldexGen3DiagReference.lookup("Wheel sensor 2A or 2B continuity")!!
        assertFalse(wheel.exactPair)
        assertTrue(wheel.component!!.contains("2A или 2B"))
        assertTrue(wheel.condition!!.contains("не определено"))
        val valve=HaldexGen3DiagReference.lookup("EPRV 21 or 22 dump solenoid short to B+")!!
        assertFalse(valve.exactPair)
        assertTrue(valve.component!!.contains("21 или 22"))
        assertTrue(valve.source!!.endsWith("#page=110"))
        assertNull(HaldexGen3DiagReference.lookup("Wheel sensor 3A or 3B continuity"))
        assertNull(HaldexGen3DiagReference.lookup("EPRV 21 hold solenoid short circuit"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE,"Wheel sensor 2A or 2B continuity"))
    }
    @Test fun onlyAdditionalDocumentedLabels() {
        assertEquals(4,HaldexGen3DiagReference.count)
        val labels=listOf("Brake apply solenoid unspecified fault","Excessive reservoir pressure","ECU shutdown FET","External TPMS")
        for(label in labels) {
            val r=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_DIAG,label)!!
            assertTrue(r.exactPair)
            assertTrue(r.component!!.isNotBlank())
            assertTrue(r.condition!!.isNotBlank())
            assertTrue(r.source!!.contains("haldex.com"))
            assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN2_INFO1,label))
            assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,label))
        }
        assertTrue(HaldexGen3DiagReference.lookup("Excessive reservoir pressure")!!.condition!!.contains("9,75"))
        assertNull(HaldexGen3DiagReference.lookup("NO LINK"))
        assertNull(HaldexGen3DiagReference.lookup("S1A CONT"))
        assertNull(HaldexGen3DiagReference.lookup("ECU shutdown"))
        assertNull(HaldexGen3DiagReference.lookup("External TPMS 1"))
    }
}
