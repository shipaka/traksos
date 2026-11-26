package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class BendixTabs6ReferenceTest {
    @Test fun separateDisplayFamily() {
        assertEquals(46,BendixTabs6Reference.count)
        assertEquals("Колёсный датчик SAR",BendixTabs6Reference.lookup("5/6")?.component)
        assertEquals("КЗ",BendixTabs6Reference.lookup("9/2")?.condition)
        assertNotNull(DisplayReferenceLookup.find(DisplayReferenceEdition.BENDIX_TABS6,"14/2"))
        for(s in listOf("1/1","2/6","3/6","7/4","9/5","02/04","137")) assertNull(BendixTabs6Reference.lookup(s))
    }
    @Test fun reverseIndexKeepsMultipleCandidates() {
        assertEquals(setOf("4/5","4/6"),BendixTabs6Reference.bySidFmi(3,13).map { it.blink }.toSet())
        assertEquals(setOf("7/3","10/3"),BendixTabs6Reference.bySidFmi(7,7).map { it.blink }.toSet())
        assertEquals("6/2",BendixTabs6Reference.bySidFmi(251,4).single().blink)
        assertTrue(BendixTabs6Reference.bySidFmi(999,0).isEmpty())
        assertEquals(ScopeGroup.FUTURE_MARKET,CoverageRoadmap.byId("bendix-tabs6")?.scope)
    }
}
