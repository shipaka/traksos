package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class KnorrSorlReferenceTest {
    @Test fun knorrGroupedFieldsAndConflictingRowsExcluded() {
        assertEquals(44,KnorrSorlReference.knorrCount)
        assertEquals("Колёсный датчик SAR",KnorrSorlReference.knorr("5/6")?.first)
        assertEquals("M22",KnorrSorlReference.knorr("7/4")?.first)
        assertEquals("M21",KnorrSorlReference.knorr("8/2")?.first)
        for(code in listOf("1/1","12/1","13/1","7/1","6/4","2.4","02/04"))
            assertNull(KnorrSorlReference.knorr(code))
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_KB4TA,"2/4"))
    }
    @Test fun sorlIndependentNamespace() {
        assertEquals(10,KnorrSorlReference.sorlCount)
        assertEquals("Датчик, гнездо 4",KnorrSorlReference.sorl("4.4")?.first)
        assertNull(KnorrSorlReference.sorl("4.5"))
        assertNull(KnorrSorlReference.sorl("3/1"))
        assertNull(KnorrSorlReference.sorl("5.1"))
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.SORL_ABS,"3.1"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_KB4TA,"3.1"))
    }
}
