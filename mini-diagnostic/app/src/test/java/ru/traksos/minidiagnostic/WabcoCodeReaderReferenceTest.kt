package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class WabcoCodeReaderReferenceTest {
    @Test fun independentFieldsByExactEdition() {
        assertEquals(19,WabcoCodeReaderReference.vcsComponentCount)
        assertEquals(30,WabcoCodeReaderReference.dComponentCount)
        assertEquals(131,WabcoCodeReaderReference.eComponentCount)
        assertEquals(180,WabcoCodeReaderReference.componentCount)
        val v=DisplayReferenceEdition.WABCO_VCS2_READER
        val d=DisplayReferenceEdition.WABCO_D_READER
        val e=DisplayReferenceEdition.WABCO_E_READER
        assertTrue(DisplayReferenceLookup.find(v,"003/07")!!.condition!!.contains("кольца"))
        assertEquals("Датчик скорости колеса c",DisplayReferenceLookup.find(d,"1/5")!!.component)
        assertTrue(DisplayReferenceLookup.find(e,"1/5")!!.component!!.contains("A",true))
        assertTrue(DisplayReferenceLookup.find(d,"1/5")!!.condition!!.contains("Обрыв"))
        assertTrue(DisplayReferenceLookup.find(e,"172/15")!!.condition!!.contains("Остаточное"))
        assertFalse(DisplayReferenceLookup.find(e,"172/15")!!.exactPair)
        assertTrue(DisplayReferenceLookup.find(e,"172/15")!!.source!!.contains("#page=24"))
        assertNull(DisplayReferenceLookup.find(d,"172/15"))
        assertNull(DisplayReferenceLookup.find(v,"1/5"))
        assertNull(DisplayReferenceLookup.find(e,"255/1"))
        assertNull(DisplayReferenceLookup.find(e,"144/16"))
        assertNull(DisplayReferenceLookup.find(e,"144/1 (1)"))
    }
}
