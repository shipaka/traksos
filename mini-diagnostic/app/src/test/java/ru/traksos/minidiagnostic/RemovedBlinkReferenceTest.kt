package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class RemovedBlinkReferenceTest {
    @Test fun removedLookupEditionsDoNotExist() {
        assertEquals(23,DisplayReferenceEdition.entries.size)
        assertTrue(DisplayReferenceEdition.entries.none { it.name in setOf("VARIO_C_EXAMPLES","VCS_I_EXPERT","VCS_II_FLASH","HALDEX_UABS_ACTIVE","KNORR_KB4TA","SORL_ABS","EKRAN_EBP","BENDIX_TABS6") })
        assertEquals(listOf(DisplayReferenceEdition.SORL_ABS_TESTER_36302900020),ReferenceSelection.forTarget("sorl-trailer-abs"))
        for(id in listOf("zf-vario-c","zf-vcs","zf-vcs-ii","kb-kb4ta","kb-kb4ta-d","haldex-uabs","ekran-ebp","bendix-tabs6")) {
            assertTrue(ReferenceSelection.forTarget(id).isEmpty())
            assertNotEquals(ResearchStage.DISPLAY_REFERENCE_PARTIAL,CoverageRoadmap.byId(id)?.stage)
        }
    }
}
