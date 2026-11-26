package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class CatalogModulePartsTest {
    @Test fun exactCatalogNumbers() {
        assertEquals(83,CatalogModuleParts.count)
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
    @Test fun modernHaldexExactNumbersOnly() {
        for(number in listOf("842005001","842005011","842006001","842015001","842015011","842001001","842001011","842002001","842011001","842011121","842011811","842011401","842003001","842003011","842004001","842013001","842013011","842013131","942015001","942011001","942011121","942011811","942011401","942013131","841001001","823034001","810023001")) {
            val entry=CatalogModuleParts.find(number).single()
            assertEquals(if(number in listOf("823034001","810023001")) "haldex-eb3" else "haldex-eb4",entry.targetId)
            assertTrue(ModuleSearch.find(number).any { it.id==entry.targetId })
        }
        assertTrue(CatalogModuleParts.find("841001001").single().variant.contains("не основной ECU"))
        assertEquals("Basic+ 2M AM",CatalogModuleParts.find("942 011 121").single().variant)
        assertEquals("Premium+ 2M",CatalogModuleParts.find("842013131").single().variant)
        for(number in listOf("842005999","842005XXX","950800923","823028001","844511065","844001120")) {
            assertTrue(CatalogModuleParts.find(number).isEmpty())
        }
    }
    @Test fun knorrTypeAndPartNumbersKeepVariantsSeparate() {
        for(number in listOf("K211213","K211212","K211211","K267862","K267861","ES2031","ES2033","ES2035")) {
            assertEquals("kb-itebs-x",ModuleSearch.find(number).single().id)
            assertEquals("kb-itebs-x",CatalogModuleParts.find(number).single().targetId)
        }
        assertTrue(CatalogModuleParts.find("K267862").single().variant.contains("ECO / PLUS"))
        assertEquals(CatalogModuleParts.find("K211212"),CatalogModuleParts.find(" k211212v01n49 "))
        assertTrue(CatalogModuleParts.find("ES2035").single().variant.contains("LAC"))
        for(number in listOf("K211214","K211212V01","K211212V01N4","K211212X01N49","K202012V02N49","ES2032","K112780N00"))
            assertTrue(CatalogModuleParts.find(number).isEmpty())
        for(q in listOf("iTEBS X ECO","iTEBS X PLUS","iTEBS X LAC","айтебс икс"))
            assertEquals("kb-itebs-x",ModuleSearch.find(q).first().id)
    }
    @Test fun sharedSlaveNumbersRemainAmbiguous() {
        for(number in listOf("810011001","812011001")) {
            assertEquals(setOf("haldex-eb1","haldex-eb2"),ModuleSearch.find(number).map { it.id }.toSet())
        }
        assertEquals("haldex-eb1",ModuleSearch.find("810003101").single().id)
        assertEquals("zf-vcs-ii",ModuleSearch.find("4461080700").single().id)
    }
}
