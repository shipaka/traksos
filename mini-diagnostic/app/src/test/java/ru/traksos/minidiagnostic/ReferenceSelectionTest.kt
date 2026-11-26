package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class ReferenceSelectionTest {
    @Test fun onlyExplicitAssociations() {
        val documented=CoverageRoadmap.targets.filter { it.stage==ResearchStage.DISPLAY_REFERENCE_PARTIAL }.map { it.id }.toSet()
        assertEquals(documented,ReferenceSelection.targetIds)
        assertEquals(12,documented.size)
        assertEquals(listOf(DisplayReferenceEdition.WABCO_E,DisplayReferenceEdition.WABCO_E_SYSTEM,DisplayReferenceEdition.WABCO_E_HUMBAUR),ReferenceSelection.forTarget("zf-tebs-e"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_GEN2_INFO1),ReferenceSelection.forTarget("haldex-eb2"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_GEN3_INFO1,DisplayReferenceEdition.HALDEX_GEN3_DIAG),ReferenceSelection.forTarget("haldex-eb3"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE),ReferenceSelection.forTarget("haldex-eb4"))
        assertEquals(listOf(DisplayReferenceEdition.KNORR_G22_PRESSURE),ReferenceSelection.forTarget("kb-g22"))
        for(id in listOf(null,"unknown","zf-iebs","kb-g20","kb-g21","sorl-research","kormee-research","ekran-ebpv"))
            assertTrue(ReferenceSelection.forTarget(id).isEmpty())
    }
    @Test fun generalTesterNotImplicitlyAssigned() {
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.WABCO_COMPACT_TESTER in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.KNORR_G2_EXAMPLE in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.KNORR_G2_TD2077 in ReferenceSelection.forTarget(it.id) })
        assertFalse(DisplayReferenceEdition.HALDEX_GEN3_INFO1 in ReferenceSelection.forTarget("haldex-eb2"))
        assertFalse(DisplayReferenceEdition.WABCO_D in ReferenceSelection.forTarget("zf-tebs-e"))
    }
}
