package ru.traksos.minidiagnostic

// Pure policy model. Not wired to BLE, power, or GPIO. No production profiles exist.
data class RouteIdentity(val targetId:String,val partNumber:String,val hardwareRevision:String,
    val softwareVersion:String,val cableId:String,val place:ConnectionPlace,val path:ElectricalPath)
data class VerifiedRoute(val identity:RouteIdentity,val evidenceId:String,
    val readValidated:Boolean,val clearValidated:Boolean)
enum class RouteAction { READ, CLEAR }
enum class RouteDenial { UNKNOWN_ROUTE, NOT_VALIDATED, HARDWARE_NOT_READY, UNSAFE_SETUP, CLEAR_NOT_CONFIRMED, INPUT_ONLY }
sealed interface RouteDecision {
    data class Denied(val reason:RouteDenial):RouteDecision
    data class BenchEligible(val route:RouteIdentity):RouteDecision
}
data class BenchConditions(val hardwareReviewed:Boolean,val interlockVerified:Boolean,
    val isolatedStationaryBench:Boolean,val cableVerified:Boolean,val lightingOff:Boolean,
    val repairConfirmed:Boolean=false)
class DiagnosticRoutePolicy(verified:List<VerifiedRoute> = emptyList()) {
    private val index=verified.associateBy { it.identity }
    init {
        require(index.size==verified.size)
        require(verified.all {
            val r=it.identity
            listOf(r.targetId,r.partNumber,r.hardwareRevision,r.softwareVersion,r.cableId,it.evidenceId).all { s->s.isNotBlank() } &&
                r.place!=ConnectionPlace.UNKNOWN &&
                r.path in DiagnosticGuide.entry(r.place).possiblePaths &&
                (!it.clearValidated || it.readValidated) &&
                (r.path!=ElectricalPath.WARNING_INPUT || !it.clearValidated)
        })
    }
    fun evaluate(identity:RouteIdentity?,action:RouteAction,conditions:BenchConditions):RouteDecision {
        fun deny(reason:RouteDenial)=RouteDecision.Denied(reason)
        val verified=identity?.let { index[it] } ?: return deny(RouteDenial.UNKNOWN_ROUTE)
        if(!conditions.hardwareReviewed || !conditions.interlockVerified) return deny(RouteDenial.HARDWARE_NOT_READY)
        if(!conditions.isolatedStationaryBench || !conditions.cableVerified || !conditions.lightingOff) return deny(RouteDenial.UNSAFE_SETUP)
        if(action==RouteAction.CLEAR && verified.identity.path==ElectricalPath.WARNING_INPUT) return deny(RouteDenial.INPUT_ONLY)
        if(!verified.readValidated || (action==RouteAction.CLEAR && !verified.clearValidated)) return deny(RouteDenial.NOT_VALIDATED)
        if(action==RouteAction.CLEAR && !conditions.repairConfirmed) return deny(RouteDenial.CLEAR_NOT_CONFIRMED)
        return RouteDecision.BenchEligible(verified.identity)
    }
}
