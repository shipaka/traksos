package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class ModernDisplayExamplesTest {
    @Test fun observedExamplesOnly() {
        val h=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE,"S1A continuity")!!
        assertTrue(h.exactPair)
        assertTrue(h.component!!.contains("1A"))
        assertNotNull(ModernDisplayExamples.haldex4("S1B continuity"))
        assertNull(ModernDisplayExamples.haldex4("S1A CONT"))
        val w=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E_HUMBAUR,"251/05")!!
        assertTrue(w.exactPair)
        assertTrue(w.condition!!.contains("обрыв"))
        assertNull(ModernDisplayExamples.wabcoE("251/04"))
        assertNull(ModernDisplayExamples.wabcoE("003/05"))
        assertEquals(26,ModernDisplayExamples.count)
    }
}
