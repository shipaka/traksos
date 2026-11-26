package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class DisplayReferenceLookupTest {
    @Test fun namespacesAndEditionsStaySeparate() {
        val v=DisplayReferenceLookup.find(DisplayReferenceEdition.VIE_101,"5/5")!!
        assertEquals("Датчик скорости колеса C",v.component)
        assertTrue(v.exactPair)
        val w=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"005/05")!!
        assertEquals("Колёсный датчик E",w.component)
        assertFalse(w.exactPair)
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.VIE_101,"005/05"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"5/5"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_D,"FFFFFF"))
        assertNotEquals(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_D,"007/05")?.component,
            DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"007/05")?.component)
    }
}
