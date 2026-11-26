package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class CatalogModulePartsTest {
    @Test fun exactCatalogNumbers() {
        assertEquals(136,CatalogModuleParts.count)
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
    @Test fun originalTebsCNumbersDoNotResolveToTebsD() {
        for(number in listOf("4801020000","4801020010","4801020020","4801020040","4801020050")) {
            assertEquals("zf-tebs-c",CatalogModuleParts.find(number).single().targetId)
            assertEquals("zf-tebs-c",ModuleSearch.find(number).single().id)
        }
        assertEquals("zf-tebs-c",ModuleSearch.find("480 102 000 0").single().id)
        assertTrue(CatalogModuleParts.find("4801020099").isEmpty())
    }
    @Test fun g2FamiliesAndSharedTypeAreNotConflated() {
        assertEquals("kb-g20",CatalogModuleParts.find("K019300").single().targetId)
        assertEquals("kb-g20",CatalogModuleParts.find("K019302").single().targetId)
        assertEquals("kb-g20",CatalogModuleParts.find("K019309").single().targetId)
        assertEquals("kb-g20",CatalogModuleParts.find("K019340").single().targetId)
        assertEquals("kb-g20",CatalogModuleParts.find("K019342").single().targetId)
        assertEquals("kb-g20",CatalogModuleParts.find("K019349").single().targetId)
        assertEquals("kb-g21",CatalogModuleParts.find("K019310").single().targetId)
        assertEquals("kb-g21",CatalogModuleParts.find("K019312").single().targetId)
        assertEquals("kb-g21",CatalogModuleParts.find("K019319").single().targetId)
        assertEquals("kb-g21",CatalogModuleParts.find("K019350").single().targetId)
        assertEquals("kb-g21",CatalogModuleParts.find("K019352").single().targetId)
        assertEquals("kb-g21",CatalogModuleParts.find("K019359").single().targetId)
        assertEquals("kb-g22",CatalogModuleParts.find("K055332").single().targetId)
        assertEquals("kb-g22",CatalogModuleParts.find("K055372").single().targetId)
        assertEquals("kb-g22",CatalogModuleParts.find("K055379").single().targetId)
        assertEquals("kb-g22",CatalogModuleParts.find("K110612").single().targetId)
        assertEquals("kb-g22",CatalogModuleParts.find("K110619").single().targetId)
        assertEquals("kb-g22",CatalogModuleParts.find("ES2095").single().targetId)
        assertEquals(setOf("kb-g20","kb-g21"),ModuleSearch.find("ES2060").map { it.id }.toSet())
        assertTrue(CatalogModuleParts.find("ES2090").single().variant.contains("Standard Plus"))
        assertTrue(CatalogModuleParts.partDidCandidates("ES2060").isEmpty())
        assertEquals(listOf("kb-g22"),CatalogModuleParts.partDidCandidates("K110619V04N50"))
        assertTrue(CatalogModuleParts.find("K110613").isEmpty())
        assertTrue(CatalogModuleParts.find("K021940").isEmpty())
    }
    @Test fun exactG22AndWabcoEModelAssociations() {
        for(number in listOf("K055342","K055352","K055362","K055369","ES2090")) {
            assertEquals("kb-g22",CatalogModuleParts.find(number).single().targetId)
            assertEquals("kb-g22",ModuleSearch.find(number).single().id)
        }
        for(number in listOf("4801020300","4801020320","4801020620","4801020800")) {
            assertEquals("zf-tebs-e",CatalogModuleParts.find(number).single().targetId)
            assertEquals("zf-tebs-e",ModuleSearch.find(number).single().id)
        }
        assertTrue(CatalogModuleParts.find("K055343").isEmpty())
        assertEquals(CatalogModuleParts.find("K055342"),CatalogModuleParts.find("K055342V02N99"))
        assertTrue(CatalogModuleParts.partDidCandidates("ES2090").isEmpty())
    }
    @Test fun uabsVariantsDistinguishElectronicCapabilityAndServiceKits() {
        for(number in listOf("364564001","364569001","364565001","364570001","364566001","364571001","950364824","950364825","950364826")) {
            assertEquals("haldex-uabs",CatalogModuleParts.find(number).single().targetId)
            assertEquals("haldex-uabs",ModuleSearch.find(number).single().id)
        }
        for(number in listOf("364566001","364571001","950364826"))
            assertTrue(CatalogModuleParts.find(number).single().variant.contains("CAN-диагностики нет"))
        assertTrue(CatalogModuleParts.find("950 364 824").single().variant.contains("комплект"))
        assertTrue(CatalogModuleParts.find("364564002").isEmpty())
        assertTrue(CatalogModuleParts.find("950364820").isEmpty())
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
    @Test fun russianAndChineseCatalogMatchesDoNotGuessBrandOrBus() {
        for(number in listOf("4801020630","480 102 064 0")) {
            assertEquals(setOf("zf-tebs-e","vie-tebs","vie-tebs-subsystem"),ModuleSearch.find(number).map { it.id }.toSet())
            assertEquals(3,CatalogModuleParts.find(number).size)
        }
        assertEquals("ekran-ebp",ModuleSearch.find("АДЮИ.453633.005").single().id)
        assertEquals("ekran-ebpv",CatalogModuleParts.find("адюи 453633 024").single().targetId)
        assertEquals("sorl-trailer-abs",ModuleSearch.find("35503100090").single().id)
        assertEquals("sorl-research",ModuleSearch.find("35682030050").single().id)
        assertTrue(CatalogModuleParts.find("35682030020").isEmpty())
        assertTrue(CatalogModuleParts.find("АДЮИ.453766.011").isEmpty())
        assertTrue(CatalogModuleParts.find("АДЮИ.453633.024-01").isEmpty())
        assertTrue(CatalogModuleParts.find("4801020699").isEmpty())
    }
    @Test fun sharedSlaveNumbersRemainAmbiguous() {
        for(number in listOf("810011001","812011001")) {
            assertEquals(setOf("haldex-eb1","haldex-eb2"),ModuleSearch.find(number).map { it.id }.toSet())
        }
        assertEquals("haldex-eb1",ModuleSearch.find("810003101").single().id)
        assertEquals("zf-vcs-ii",ModuleSearch.find("4461080700").single().id)
    }
}
