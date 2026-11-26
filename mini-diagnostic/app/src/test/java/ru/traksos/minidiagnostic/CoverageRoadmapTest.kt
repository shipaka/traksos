package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class CoverageRoadmapTest {
    @Test fun distinctTargetsAndSources() {
        val rows=CoverageRoadmap.targets
        assertEquals(36,rows.size)
        assertEquals(rows.size,rows.map { it.id }.toSet().size)
        assertTrue(rows.all { it.model.isNotBlank() && it.evidence.startsWith("https://") })
        assertEquals(11,rows.count { it.stage==ResearchStage.DISPLAY_REFERENCE_PARTIAL })
        assertEquals(1,rows.count { it.stage==ResearchStage.CANDIDATE })
    }
    @Test fun generationsAndDifferentElectricalMarketsStaySeparate() {
        assertNotEquals(CoverageRoadmap.byId("kb-g20"),CoverageRoadmap.byId("kb-g22"))
        assertEquals(ScopeGroup.INTERFACE_REVIEW,CoverageRoadmap.byId("kb-tebs4")?.scope)
        assertEquals(ScopeGroup.FUTURE_MARKET,CoverageRoadmap.byId("bendix-tabs6")?.scope)
        assertNull(CoverageRoadmap.byId("unknown"))
        assertNull(ProfileRegistry().exact(EcuIdentity(EcuFamily.WABCO_TEBS_E,"4801020000","unknown")))
    }
}
