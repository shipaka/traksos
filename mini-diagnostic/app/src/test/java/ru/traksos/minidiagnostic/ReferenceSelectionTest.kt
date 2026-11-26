package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class ReferenceSelectionTest {
    @Test fun onlyExplicitAssociations() {
        val documented=CoverageRoadmap.targets.filter { it.stage==ResearchStage.DISPLAY_REFERENCE_PARTIAL }.map { it.id }.toSet()
        assertEquals(documented,ReferenceSelection.targetIds)
        assertEquals(10,documented.size)
        assertEquals(listOf(DisplayReferenceEdition.WABCO_E,DisplayReferenceEdition.WABCO_E_SYSTEM),ReferenceSelection.forTarget("zf-tebs-e"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_GEN2_INFO1),ReferenceSelection.forTarget("haldex-eb2"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_GEN3_INFO1,DisplayReferenceEdition.HALDEX_GEN3_DIAG),ReferenceSelection.forTarget("haldex-eb3"))
        for(id in listOf(null,"unknown","zf-iebs","kb-g20","kb-g22","sorl-research","kormee-research","haldex-eb4","ekran-ebpv"))
            assertTrue(ReferenceSelection.forTarget(id).isEmpty())
    }
    @Test fun generalTesterNotImplicitlyAssigned() {
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.WABCO_COMPACT_TESTER in ReferenceSelection.forTarget(it.id) })
        assertFalse(DisplayReferenceEdition.HALDEX_GEN3_INFO1 in ReferenceSelection.forTarget("haldex-eb2"))
        assertFalse(DisplayReferenceEdition.WABCO_D in ReferenceSelection.forTarget("zf-tebs-e"))
    }
}
