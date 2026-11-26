package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class DemoElectricalPreviewTest {
    @Test fun unavailableIsNotZeroAndIsNotHealthy() {
        for(s in DemoElectricalCase.entries) {
            val d=DemoElectricalPreview.snapshot(false,s)
            assertNull(d.supplyMv)
            assertNull(d.returnOk)
            assertNull(d.canTraffic)
            assertFalse(d.canRunDemo)
        }
        assertEquals(0,DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_POWER).supplyMv)
    }
    @Test fun onlyNormalScenarioReturnsDemoFaults() {
        for(s in DemoElectricalCase.entries) {
            val d=DemoElectricalPreview.snapshot(true,s)
            assertEquals(s==DemoElectricalCase.NORMAL,d.canRunDemo)
        }
        val sag=DemoElectricalPreview.snapshot(true,DemoElectricalCase.SAG)
        assertTrue(sag.minimumMv!! < sag.supplyMv!!)
        assertEquals(false,DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_RETURN).returnOk)
        assertNull(DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_CAN).canErrors)
    }
}
