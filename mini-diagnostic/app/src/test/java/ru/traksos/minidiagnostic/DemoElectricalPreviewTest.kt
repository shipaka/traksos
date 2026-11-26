package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class DemoElectricalPreviewTest {
    @Test fun unavailableIsNotZeroAndIsNotHealthy() {
        for(s in DemoElectricalCase.entries) {
            val d=DemoElectricalPreview.snapshot(false,s)
            assertNull(d.supplyMv)
            assertNull(d.canTraffic)
            assertFalse(d.canRunDemo)
        }
        assertEquals(0,DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_POWER).supplyMv)
    }
    @Test fun optionalMeasurementIsNotRequiredForDemoSearch() {
        for(s in DemoElectricalCase.entries) {
            val d=DemoElectricalPreview.snapshot(true,s)
            assertEquals(s==DemoElectricalCase.NORMAL || s==DemoElectricalCase.NO_MEASUREMENT,d.canRunDemo)
        }
        val sag=DemoElectricalPreview.snapshot(true,DemoElectricalCase.SAG)
        assertTrue(sag.minimumMv!! < sag.supplyMv!!)
        assertNull(DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_MEASUREMENT).supplyMv)
        assertNull(DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_CAN).canErrors)
    }
}
