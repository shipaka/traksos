package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class TrailerDiagnosticScopeTest {
    @Test fun threePhysicalPlacesAndPathsOnly() {
        assertEquals(listOf(ConnectionPlace.FRONT,ConnectionPlace.SIDE,ConnectionPlace.DIRECT),TrailerDiagnosticScope.places)
        assertFalse(TrailerDiagnosticScope.isPhysicalPlace(ConnectionPlace.UNKNOWN))
        assertEquals(3,ElectricalPath.entries.size)
        assertTrue(CableResearch.rows.all { TrailerDiagnosticScope.isPhysicalPlace(it.place) })
        assertEquals(16,CableResearch.rows.size)
        assertEquals(9,CableResearch.rows.count { it.path!=null })
    }
    @Test fun prioritiesPreserveCatalog() {
        val all=TrailerDiagnosticScope.prioritized(CoverageRoadmap.targets)
        assertEquals(36,all.size)
        assertEquals(14,all.count { TrailerDiagnosticScope.priority(it)==TrailerPriority.MODERN })
        assertEquals(11,all.count { TrailerDiagnosticScope.priority(it)==TrailerPriority.PRIMARY })
        assertEquals(7,all.count { TrailerDiagnosticScope.priority(it)==TrailerPriority.LEGACY })
        assertEquals(4,all.count { TrailerDiagnosticScope.priority(it)==TrailerPriority.OUTSIDE })
        assertEquals(TrailerPriority.MODERN,TrailerDiagnosticScope.priority(CoverageRoadmap.byId("zf-iebs")!!))
        assertEquals(TrailerPriority.LEGACY,TrailerDiagnosticScope.priority(CoverageRoadmap.byId("zf-vario-c")!!))
    }
}
