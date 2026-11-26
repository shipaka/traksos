package ru.traksos.minidiagnostic

// Capability policy for future hardware variants. Not a board detection protocol.
enum class DeviceVariant { LIGHT_AND_DIAGNOSTICS, DIAGNOSTICS_ONLY, UNKNOWN }
object DeviceScope {
    fun permittedOperations(variant:DeviceVariant):Set<Op> = when(variant) {
        DeviceVariant.LIGHT_AND_DIAGNOSTICS -> setOf(Op.STATE,Op.ALL_OFF,Op.HEARTBEAT,Op.SET_LIGHTS,Op.RESET_FAULT,Op.IDENTIFY_ECU,Op.READ_DTC,Op.CLEAR_DTC)
        DeviceVariant.DIAGNOSTICS_ONLY -> setOf(Op.STATE,Op.ALL_OFF,Op.HEARTBEAT,Op.IDENTIFY_ECU,Op.READ_DTC,Op.CLEAR_DTC)
        DeviceVariant.UNKNOWN -> setOf(Op.ALL_OFF)
    }
    // This is an upper bound on features, NEVER an authorization to execute an operation.
    // Both real variants still require independent route/electrical/session validation.
}
