package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class KnorrTebs4ReferenceTest {
    @Test fun selectedCodesAndNamespaces() {
        assertEquals(125,KnorrTebs4Reference.count)
        assertEquals("Датчик колеса SAL",KnorrTebs4Reference.lookup("137")?.first)
        assertEquals("КЗ на массу",KnorrTebs4Reference.lookup("140")?.second)
        assertEquals("Давление питания",KnorrTebs4Reference.lookup("121")?.first)
        assertEquals("Недостаточное напряжение",KnorrTebs4Reference.lookup("10")?.second)
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_TEBS4,"137"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_KB4TA,"137"))
        for(code in listOf("9","11","41","44","58","95","96","100","107","130","141","148","153","155","165","171","0","173","0137","2/4","89FF")) assertNull(KnorrTebs4Reference.lookup(code))
    }
}
