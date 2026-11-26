package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class ReferenceSelectionTest {
    @Test fun onlyExplicitAssociations() {
        val documented=CoverageRoadmap.targets.filter { it.stage==ResearchStage.DISPLAY_REFERENCE_PARTIAL }.map { it.id }.toSet()
        assertEquals(documented,ReferenceSelection.targetIds)
        assertEquals(15,documented.size)
        assertEquals(listOf(DisplayReferenceEdition.WABCO_VCS2_READER),ReferenceSelection.forTarget("zf-vcs-ii"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_UABS_INFO2),ReferenceSelection.forTarget("haldex-uabs"))
        assertEquals(listOf(DisplayReferenceEdition.WABCO_E,DisplayReferenceEdition.WABCO_E_SYSTEM,DisplayReferenceEdition.WABCO_E_HUMBAUR,DisplayReferenceEdition.WABCO_E_OEM_EXACT,DisplayReferenceEdition.WABCO_E_READER),ReferenceSelection.forTarget("zf-tebs-e"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_GEN2_INFO1),ReferenceSelection.forTarget("haldex-eb2"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_GEN3_INFO1,DisplayReferenceEdition.HALDEX_GEN3_DIAG),ReferenceSelection.forTarget("haldex-eb3"))
        assertEquals(listOf(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE),ReferenceSelection.forTarget("haldex-eb4"))
        assertEquals(listOf(DisplayReferenceEdition.KNORR_G22_PRESSURE),ReferenceSelection.forTarget("kb-g22"))
        assertEquals(listOf(DisplayReferenceEdition.SORL_ABS_TESTER_36302900020),ReferenceSelection.forTarget("sorl-trailer-abs"))
        for(id in listOf(null,"unknown","zf-iebs","kb-g20","kb-g21","sorl-research","kormee-research","ekran-ebpv"))
            assertTrue(ReferenceSelection.forTarget(id).isEmpty())
    }
    @Test fun generalTesterNotImplicitlyAssigned() {
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.HALDEX_CAN_HUB in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.HALDEX_SOFT_DOCKING_GEN3 in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.WABCO_CAN_ROUTER in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.WABCO_ELEX in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.WABCO_COMPACT_TESTER in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.KNORR_G2_EXAMPLE in ReferenceSelection.forTarget(it.id) })
        assertTrue(CoverageRoadmap.targets.none { DisplayReferenceEdition.KNORR_G2_TD2077 in ReferenceSelection.forTarget(it.id) })
        assertFalse(DisplayReferenceEdition.HALDEX_GEN3_INFO1 in ReferenceSelection.forTarget("haldex-eb2"))
        assertFalse(DisplayReferenceEdition.WABCO_D in ReferenceSelection.forTarget("zf-tebs-e"))
    }
}
