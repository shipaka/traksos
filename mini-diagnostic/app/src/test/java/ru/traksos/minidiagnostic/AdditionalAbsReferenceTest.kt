package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class AdditionalAbsReferenceTest {
    @Test fun haldexOnlyImplementedFaultBlinks() {
        assertEquals(33,AdditionalAbsReference.haldexCount)
        for(code in listOf("00","07","20","63","69","73","79","83","89","1","1/1")) assertNull(AdditionalAbsReference.haldex(code))
        assertEquals("Датчик колеса S1A",AdditionalAbsReference.haldex("01")?.first)
        assertEquals("Напряжение выше 32 В",AdditionalAbsReference.haldex("92")?.second)
    }
    @Test fun ekranExactPairsAndNoHealthyClaim() {
        assertEquals(34,AdditionalAbsReference.ekranCount)
        assertEquals("Датчик колеса 1L",AdditionalAbsReference.ekran("1/3")?.first)
        assertEquals("Датчик колеса 2R",AdditionalAbsReference.ekran("2/7")?.first)
        assertEquals("Модулятор М3",AdditionalAbsReference.ekran("5/6")?.first)
        assertNull(AdditionalAbsReference.ekran("0/0"))
        assertNull(AdditionalAbsReference.ekran("1/4"))
        assertNull(AdditionalAbsReference.ekran("13"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_UABS_ACTIVE,"1/3"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.EKRAN_EBP,"01"))
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.EKRAN_EBP,"6/4"))
    }
}
