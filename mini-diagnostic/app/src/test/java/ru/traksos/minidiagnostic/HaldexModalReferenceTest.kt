package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class HaldexModalReferenceTest {
    @Test fun supportedCodesAndAmbiguousIndications() {
        assertEquals(52,HaldexModalReference.count)
        assertEquals("Датчик колеса 3A",HaldexModalReference.lookup("05")?.first)
        assertEquals("Датчик колеса 3B",HaldexModalReference.lookup("26")?.first)
        assertEquals("Клапан удержания (жёлтый)",HaldexModalReference.lookup("83")?.first)
        assertTrue(HaldexModalReference.lookup("90")!!.second.contains("18 В"))
        assertNotNull(HaldexModalReference.lookup("CF"))
        for(code in listOf("00","07","37","88","CA","CC","A1","A2","A3","db","E0","E9","5","0A"))
            assertNull(HaldexModalReference.lookup(code))
    }
    @Test fun modalDigitalLookupRemainsWithoutRemovedLampEdition() {
        val m=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_MODAL_MODULAR,"90")!!
        assertEquals(HaldexModalReference.SOURCE,m.source)
        assertTrue(m.condition!!.contains("18 В"))
        assertTrue(m.exactPair)
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_MODAL_MODULAR,"05"))
        assertTrue(DisplayReferenceEdition.entries.none { it.name=="HALDEX_UABS_ACTIVE" })
        // U-ABS now has its own electronic Info Centre 2 edition; lamp codes
        // must remain excluded, not the entire U-ABS family.
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_UABS_INFO2),ReferenceSelection.forTarget("haldex-uabs"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_UABS_INFO2,"05"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_UABS_INFO2,"90"))
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_UABS_INFO2,"Power low voltage"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_MODAL_MODULAR,"Power low voltage"))
    }
}
