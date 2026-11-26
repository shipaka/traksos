package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class HaldexUabsReferenceTest {
    @Test fun separateEditionAndThreshold() {
        assertEquals(30,HaldexUabsReference.count)
        val u=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_UABS_INFO2,"Power Low Voltage")!!
        assertTrue(u.condition!!.contains("16 В"))
        assertTrue(u.source!!.contains(HaldexUabsReference.SOURCE))
        assertTrue(u.source!!.contains(HaldexUabsReference.SOURCE_EN))
        assertEquals("A650",HaldexUabsReference.MIN_INFO_CENTRE_SOFTWARE)
        assertTrue(HaldexGen3DiagReference.lookup("Power low voltage")!!.condition!!.contains("8 В"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE,"Power Low Voltage"))
        assertNull(HaldexUabsReference.lookup("10"))
        assertNull(HaldexUabsReference.lookup("0x01"))
        assertNull(HaldexUabsReference.lookup("AUX 4"))
    }
    @Test fun ambiguityAndAliasesAreNotExtraFaults() {
        val w=HaldexUabsReference.lookup("Wheel Sensor 1A or 1B Continuity")!!
        assertFalse(w.exactPair)
        assertTrue(w.component!!.contains("1A или 1B"))
        assertFalse(HaldexUabsReference.lookup("EPRV 21 or 22 hold solenoid short circuit")!!.exactPair)
        assertEquals(HaldexUabsReference.lookup("AUX 1"),HaldexUabsReference.lookup("AUX 1 / AUX 2 / AUX 3"))
        assertEquals(HaldexUabsReference.lookup("Power ISO7638 Fail"),HaldexUabsReference.lookup("Power ISO 7638 fail"))
        assertNull(HaldexUabsReference.lookup("Wheel sensor 3A or 3B continuity"))
    }
}
