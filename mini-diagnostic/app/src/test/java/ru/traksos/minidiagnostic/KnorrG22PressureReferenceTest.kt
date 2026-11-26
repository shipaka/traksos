package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class KnorrG22PressureReferenceTest {
    @Test fun scopedAndExplicitlyMixedEvidence() {
        assertEquals(3,KnorrG22PressureReference.count)
        for((code,port) in mapOf("00ED00" to "P1","00F300" to "P21","00F500" to "P22")) {
            val r=DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_G22_PRESSURE,code)!!
            assertTrue(r.component!!.contains(port))
            assertTrue(r.condition!!.contains("730.58"))
            assertTrue(r.source!!.contains("текстовая копия"))
            assertFalse(r.exactPair)
            assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_G2_EXAMPLE,code))
            assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_TEBS4,code))
        }
        assertNull(KnorrG22PressureReference.lookup("00EC00"))
        assertNull(KnorrG22PressureReference.lookup("00F200"))
        assertNull(KnorrG22PressureReference.lookup("0x00ED00"))
    }
}
