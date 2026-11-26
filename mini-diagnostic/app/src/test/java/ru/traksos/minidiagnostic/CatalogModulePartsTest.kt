package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class CatalogModulePartsTest {
    @Test fun exactCatalogNumbers() {
        assertEquals(48,CatalogModuleParts.count)
        assertEquals("Standard",CatalogModuleParts.find("480 102 302 0").single().variant)
        assertEquals("Premium",CatalogModuleParts.find("4801024150").single().variant)
        assertEquals("zf-iebs",ModuleSearch.find("4801021050").single().id)
        assertEquals("haldex-eb2",ModuleSearch.find("820 011 101").single().id)
        assertEquals("haldex-eb4",ModuleSearch.find("942 013 001").single().id)
        assertTrue(CatalogModuleParts.find("4801023040").isEmpty())
        assertTrue(CatalogModuleParts.find("820007191").isEmpty())
        assertTrue(CatalogModuleParts.find("820 007 XXX").isEmpty())
        assertTrue(CatalogModuleParts.find("950800304").isEmpty())
        assertTrue(CatalogModuleParts.find("820028001").isEmpty())
    }
    @Test fun sharedSlaveNumbersRemainAmbiguous() {
        for(number in listOf("810011001","812011001")) {
            assertEquals(setOf("haldex-eb1","haldex-eb2"),ModuleSearch.find(number).map { it.id }.toSet())
        }
        assertEquals("haldex-eb1",ModuleSearch.find("810003101").single().id)
        assertEquals("zf-vcs-ii",ModuleSearch.find("4461080700").single().id)
    }
}
