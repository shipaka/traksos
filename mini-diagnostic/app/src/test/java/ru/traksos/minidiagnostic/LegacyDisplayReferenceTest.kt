package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class LegacyDisplayReferenceTest {
    @Test fun vcsCodeNamesComponentNotSpecificFailure() {
        assertEquals(11,LegacyDisplayReference.vcsCount)
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.VCS_II_FLASH,"3")!!
        assertEquals("Датчик колеса C",r.component)
        assertFalse(r.exactPair)
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.VCS_II_FLASH,"0"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.VCS_II_FLASH,"003/05"))
    }
    @Test fun haldexTextCodesDoNotMixWithOtherSystems() {
        assertEquals(17,LegacyDisplayReference.haldexCount)
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"S1A CONT")!!
        assertEquals("Датчик колеса 1A",r.component)
        assertEquals("Нарушение электрической цепи",r.condition)
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"3"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"S1A CONT"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"NO LINK"))
    }
}
