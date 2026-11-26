package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class WabcoVarioExamplesTest {
    @Test fun explicitExamplesOnly() {
        assertEquals(2,WabcoVarioExamples.count)
        assertEquals("Датчик колеса B",WabcoVarioExamples.lookup("1/3")?.first)
        assertEquals("Обрыв проводки",WabcoVarioExamples.lookup("2/3")?.second)
        for(s in listOf("1/2","2/4","2/0","3/10","0/0","1/1","01/03","2/1/3"))
            assertNull(WabcoVarioExamples.lookup(s))
        assertFalse(DisplayReferenceLookup.find(DisplayReferenceEdition.VARIO_C_EXAMPLES,"1/3")!!.exactPair)
    }
}
