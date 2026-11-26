package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class WabcoRouterReferenceTest {
    @Test fun separateNamespaceAndDocumentedNotes() {
        assertEquals(19,WabcoRouterReference.count)
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_CAN_ROUTER,"18312")!!
        assertTrue(r.exactPair)
        assertTrue(r.condition!!.contains("Не получены"))
        assertTrue(WabcoRouterReference.lookup("25104")!!.condition!!.contains("8 В"))
        assertFalse(WabcoRouterReference.lookup("25412")!!.exactPair)
        assertTrue(WabcoRouterReference.lookup("7805")!!.condition!!.contains("не уточнён"))
        for(code in listOf("183/12","07803","18309","25105","4711309","002/05"))
            assertNull(WabcoRouterReference.lookup(code))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_ELEX,"18312"))
    }
}
