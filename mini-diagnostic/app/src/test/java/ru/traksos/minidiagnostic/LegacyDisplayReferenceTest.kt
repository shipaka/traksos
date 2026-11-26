package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class LegacyDisplayReferenceTest {
    @Test fun haldexTextCodesDoNotMixWithOtherSystems() {
        assertEquals(72,LegacyDisplayReference.haldexCount)
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"S1A CONT")!!
        assertEquals("Датчик колеса 1A",r.component)
        assertEquals("Нарушение электрической цепи",r.condition)
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"3"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"S1A CONT"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"NO LINK"))
    }
}
