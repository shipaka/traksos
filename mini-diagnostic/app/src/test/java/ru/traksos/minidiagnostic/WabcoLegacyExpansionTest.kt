package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class WabcoLegacyExpansionTest {
    @Test fun vcsExpertPairsAreExact() {
        assertEquals(39,WabcoVcsReference.count)
        assertEquals("Колёсный датчик H2 (c)",WabcoVcsReference.lookup("3/5")?.first)
        assertEquals("Пониженное напряжение",WabcoVcsReference.lookup("14/4")?.second)
        assertNull(WabcoVcsReference.lookup("3/5/2"))
        assertNull(WabcoVcsReference.lookup("3/6"))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.VCS_II_FLASH,"3/5"))
    }
    @Test fun compactFieldsAndCountAreSeparate() {
        assertEquals(39,WabcoCompactReference.fieldCount)
        val x=WabcoCompactReference.lookup("411")!!
        assertEquals("Датчик колеса D",x.component)
        assertFalse(x.exactPair)
        assertTrue(WabcoCompactReference.lookup("H59")!!.condition!!.contains("9 или более"))
        assertTrue(WabcoCompactReference.lookup("LE1")!!.condition!!.contains("Перенапряжение"))
        assertFalse(WabcoCompactReference.lookup("UC1")!!.exactPair)
        for(code in listOf("410","4/1/1","old","UX1","000","4111","U II")) assertNull(WabcoCompactReference.lookup(code))
    }
    @Test fun printedRangesAreNotExactIdentity() {
        assertEquals(7,WabcoPartReference.ranges.size)
        assertEquals("JED 677",WabcoPartReference.find("446 105 001 0").single().linkLayer)
        assertEquals("zf-vcs",ModuleSearch.find("400 500 067 0").single().id)
        assertEquals("zf-vcs-ii",ModuleSearch.find("4461080700").single().id)
        assertEquals("zf-tcs-ii",ModuleSearch.find("4005001010").single().id)
        assertTrue(WabcoPartReference.find("4005000680").isEmpty())
        assertTrue(WabcoPartReference.find("4461050011").isEmpty())
        assertTrue(WabcoPartReference.find("WABCO4461050010").isEmpty())
    }
}
