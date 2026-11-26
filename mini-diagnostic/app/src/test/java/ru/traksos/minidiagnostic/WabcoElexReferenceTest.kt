package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class WabcoElexReferenceTest {
    @Test fun exactPairsAndSeparateAuxiliaryNamespace() {
        assertEquals(198,WabcoElexReference.count)
        assertEquals(WabcoElexReference.lookup("2944-09"),WabcoElexReference.lookup("4711309"))
        assertTrue(WabcoElexReference.lookup("2944-09")!!.condition!!.contains("Нет связи"))
        assertTrue(WabcoElexReference.lookup("4016-03")!!.condition!!.contains("Выше 30"))
        assertTrue(WabcoElexReference.lookup("2182-12")!!.component!!.contains("противоречива"))
        assertTrue(WabcoElexReference.lookup("2384-14")!!.source!!.contains("#page=38"))
        for(code in listOf("4065-12","4066-12","4067-12","4068-12","4069-12","4088-12"))
            assertNull(WabcoElexReference.lookup(code))
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_ELEX,"1552-03")!!
        assertEquals(r,DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_ELEX,"2483503"))
        assertTrue(r.exactPair)
        assertTrue(r.component!!.contains("GIO14"))
        assertTrue(r.condition!!.contains("24 В"))
        assertTrue(WabcoElexReference.lookup("1905-03")!!.condition!!.contains("ниже 9"))
        assertTrue(WabcoElexReference.lookup("1905-04")!!.condition!!.contains("выше 30"))
        for(code in listOf("1552-05","1680-05","1648-03","2637103","2688505","002/05","0x2483503"))
            assertNull(WabcoElexReference.lookup(code))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"2483503"))
        val e=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E_OEM_EXACT,"002/05")!!
        assertTrue(e.exactPair)
        assertTrue(e.condition!!.contains("Обрыв"))
        val a=WabcoEExactReference.lookup("001/07")!!
        assertFalse(a.exactPair)
        assertTrue(a.condition!!.contains("возможная причина"))
        assertTrue(a.source!!.contains("8150101383.pdf#page=25"))
        assertEquals(2,WabcoEExactReference.count)
        assertNull(WabcoEExactReference.lookup("003/05"))
        assertNull(WabcoEExactReference.lookup("144/01"))
    }
}
