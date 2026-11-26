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
    @Test fun modalAndUabsDoNotShareMeanings() {
        val m=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_MODAL_MODULAR,"90")!!
        val u=DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_UABS_ACTIVE,"90")!!
        assertNotEquals(m.condition,u.condition)
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_MODAL_MODULAR,"05"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_UABS_ACTIVE,"05"))
    }
}
