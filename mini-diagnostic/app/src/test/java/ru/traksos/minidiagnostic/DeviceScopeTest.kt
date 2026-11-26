package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class DeviceScopeTest {
    @Test fun diagnosticOnlyNeverOffersLightControl() {
        val ops=DeviceScope.permittedOperations(DeviceVariant.DIAGNOSTICS_ONLY)
        assertFalse(Op.SET_LIGHTS in ops)
        assertFalse(Op.RESET_FAULT in ops)
        assertTrue(Op.READ_DTC in ops)
        assertTrue(Op.ALL_OFF in ops)
        assertEquals(setOf(Op.ALL_OFF),DeviceScope.permittedOperations(DeviceVariant.UNKNOWN))
    }
}
