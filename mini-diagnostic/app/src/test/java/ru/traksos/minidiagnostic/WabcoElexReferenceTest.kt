package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class WabcoElexReferenceTest {
    @Test fun exactPairsAndSeparateAuxiliaryNamespace() {
        assertEquals(59,WabcoElexReference.count)
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
        assertNull(WabcoEExactReference.lookup("003/05"))
        assertNull(WabcoEExactReference.lookup("144/01"))
    }
}
