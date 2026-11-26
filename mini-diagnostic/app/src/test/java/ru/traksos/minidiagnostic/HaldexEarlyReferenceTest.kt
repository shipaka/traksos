package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class HaldexEarlyReferenceTest {
    @Test fun editionSpecificCodes() {
        assertEquals(73,HaldexEarlyReference.count)
        assertEquals("Обрыв",HaldexEarlyReference.lookup("BRK APPLY OC")?.second)
        assertNotNull(HaldexEarlyReference.lookup("BRK APPLY UNSPEC"))
        assertNotNull(HaldexEarlyReference.lookup("SUSP LOW"))
        assertNull(HaldexEarlyReference.lookup("SUSP OUT OF RANGE"))
        assertNull(HaldexEarlyReference.lookup("NO LINK"))
        assertNull(HaldexEarlyReference.lookup("ECU TIME OUT"))
        assertTrue(HaldexEarlyReference.lookup("PWR LO VOLT")!!.second.contains("19 В"))
        assertTrue(HaldexExpandedReference.gen3("PWR LO VOLT")!!.second.contains("8 В"))
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN1_2005,"SUSP LOW"))
    }
    @Test fun catalogPartNumbersOnly() {
        assertEquals(35,HaldexEarlyReference.partCount)
        assertEquals("haldex-eb1",ModuleSearch.find("810 003 101").single().id)
        assertEquals("haldex-eb1",ModuleSearch.find("812-010-001").single().id)
        assertFalse(HaldexEarlyReference.isListedPart("810003102"))
        assertFalse(HaldexEarlyReference.isListedPart("950800201"))
        assertFalse(HaldexEarlyReference.isListedPart("813003302"))
    }
}
