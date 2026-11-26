package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class DiagnosticRoutePolicyTest {
    private val fixture=RouteIdentity("fixture","TEST","HW1","SW1","TEST-CABLE",ConnectionPlace.DIRECT,ElectricalPath.K_LINE)
    private val safe=BenchConditions(true,true,true,true,true,true,sessionAuthenticated=true)
    @Test fun emptyProductionPolicyDeniesEveryRequest() {
        RouteAction.entries.forEach { assertEquals(RouteDecision.Denied(RouteDenial.UNKNOWN_ROUTE),DiagnosticRoutePolicy().evaluate(fixture,it,safe)) }
    }
    @Test fun exactIdentityRequiredAndReadClearSeparate() {
        val p=DiagnosticRoutePolicy(listOf(VerifiedRoute(fixture,"synthetic",true,false)))
        assertTrue(p.evaluate(fixture,RouteAction.READ,safe) is RouteDecision.BenchEligible)
        assertEquals(RouteDecision.Denied(RouteDenial.NOT_VALIDATED),p.evaluate(fixture,RouteAction.CLEAR,safe))
        listOf(fixture.copy(cableId="OTHER"),fixture.copy(softwareVersion="SW2"),fixture.copy(hardwareRevision="HW2"),fixture.copy(path=ElectricalPath.ISO11898)).forEach {
            assertEquals(RouteDecision.Denied(RouteDenial.UNKNOWN_ROUTE),p.evaluate(it,RouteAction.READ,safe))
        }
    }
    @Test fun allConditionsRequired() {
        val p=DiagnosticRoutePolicy(listOf(VerifiedRoute(fixture,"synthetic",true,true)))
        listOf(safe.copy(hardwareReviewed=false),safe.copy(interlockVerified=false),safe.copy(isolatedStationaryBench=false),safe.copy(cableVerified=false),safe.copy(lightingOff=false)).forEach {
            assertTrue(p.evaluate(fixture,RouteAction.READ,it) is RouteDecision.Denied)
        }
        assertEquals(RouteDecision.Denied(RouteDenial.CLEAR_NOT_CONFIRMED),p.evaluate(fixture,RouteAction.CLEAR,safe.copy(repairConfirmed=false)))
    }
    @Test fun authenticationIsMandatoryAndDefaultsToDenied() {
        val p=DiagnosticRoutePolicy(listOf(VerifiedRoute(fixture,"synthetic",true,true)))
        val unsigned=BenchConditions(true,true,true,true,true,true)
        RouteAction.entries.forEach {
            assertEquals(RouteDecision.Denied(RouteDenial.SESSION_NOT_AUTHENTICATED),p.evaluate(fixture,it,unsigned))
            assertEquals(RouteDecision.Denied(RouteDenial.SESSION_NOT_AUTHENTICATED),
                p.evaluate(fixture,it,safe.copy(sessionAuthenticated=false)))
        }
    }
    @Test fun researchNeverAuthorizes() {
        assertEquals(14,CableResearch.rows.size)
        assertEquals(2,CableResearch.search("SORL").size)
        assertTrue(CableResearch.search("vie").all { it.name.contains("VIE") })
        assertTrue(CableResearch.search("not a module").isEmpty())
        assertEquals(CableResearch.rows.size,CableResearch.rows.map { it.id }.toSet().size)
        assertTrue(CableResearch.rows.all { it.path==null || it.path in DiagnosticGuide.entry(it.place).possiblePaths })
    }
}
