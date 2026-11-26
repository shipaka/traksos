package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class TrailerDiagnosticScopeTest {
    @Test fun onlyThreePhysicalConnectionPlaces() {
        assertEquals(listOf(ConnectionPlace.FRONT,ConnectionPlace.SIDE,ConnectionPlace.DIRECT),TrailerDiagnosticScope.places)
        assertFalse(TrailerDiagnosticScope.isPhysicalPlace(ConnectionPlace.BLINK))
        assertFalse(TrailerDiagnosticScope.isPhysicalPlace(ConnectionPlace.UNKNOWN))
        assertEquals(13,CableResearch.rows.count { TrailerDiagnosticScope.isPhysicalPlace(it.place) })
        assertEquals(8,CableResearch.rows.count { TrailerDiagnosticScope.isPhysicalPlace(it.place) && it.path!=null })
    }
    @Test fun currentPriorityDoesNotDeleteLegacyCatalog() {
        val all=TrailerDiagnosticScope.prioritized(CoverageRoadmap.targets)
        assertEquals(36,all.size)
        assertEquals(25,all.count { TrailerDiagnosticScope.priority(it)==TrailerPriority.PRIMARY })
        assertEquals(7,all.count { TrailerDiagnosticScope.priority(it)==TrailerPriority.LEGACY })
        assertEquals(4,all.count { TrailerDiagnosticScope.priority(it)==TrailerPriority.OUTSIDE })
        assertEquals(TrailerPriority.PRIMARY,TrailerDiagnosticScope.priority(CoverageRoadmap.byId("zf-vcs-ii")!!))
        assertEquals(TrailerPriority.LEGACY,TrailerDiagnosticScope.priority(CoverageRoadmap.byId("zf-vario-c")!!))
    }
    @Test fun archivedDisplayCodesAreNotElectronicDtc() {
        assertFalse(TrailerDiagnosticScope.isMainReference(DisplayReferenceEdition.VCS_II_FLASH))
        assertFalse(TrailerDiagnosticScope.isMainReference(DisplayReferenceEdition.HALDEX_UABS_ACTIVE))
        assertTrue(TrailerDiagnosticScope.isMainReference(DisplayReferenceEdition.WABCO_E))
        assertEquals(946,ReferenceInventory.total())
    }
    @Test(expected=IllegalArgumentException::class)
    fun warningRouteCannotBeRegisteredEvenForRead() {
        val id=RouteIdentity("fixture","TEST","HW","SW","CABLE",ConnectionPlace.BLINK,ElectricalPath.WARNING_INPUT)
        DiagnosticRoutePolicy(listOf(VerifiedRoute(id,"fixture",true,false)))
    }
}
