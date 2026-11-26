package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class DemoReportTest {
    private val electrical=DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_MEASUREMENT)
    @Test fun snapshotRoundTripPreservesCodesDescriptionsModelAndOptionalData() {
        val r=DemoReports.make("12345678",123,"vie-tebs",electrical,Random(2))
        assertEquals("vie-tebs",r.targetId)
        assertNull(r.supplyMv)
        assertTrue(r.faults.isNotEmpty())
        assertTrue(r.faults.all{it.reference})
        assertEquals(listOf(r),DemoReportCodec.decode(DemoReportCodec.encode(listOf(r))))
        val changed=r.copy(faults=listOf(r.faults.first().copy(description="Текст\nс табуляцией\t и + %")))
        assertEquals(listOf(changed),DemoReportCodec.decode("bad\n"+DemoReportCodec.encode(listOf(changed))))
    }
    @Test fun unsupportedFamilyUsesClearlySyntheticCodesAndNeverAnotherFamily() {
        val r=DemoReports.make("87654321",456,"kormee-research",electrical,Random(1))
        assertTrue(r.faults.all{!it.reference && it.code.startsWith("DEMO-")})
        assertEquals("kormee-research",r.targetId)
        assertFalse(r.automatic)
    }
    @Test fun automaticSearchHasIdentityAndHistoryIsBounded() {
        val rows=(1..55).map { DemoReports.make(it.toString(),it.toLong(),null,electrical,Random(it)) }
        assertTrue(rows.all { it.automatic && it.serial.startsWith("DEMO-") })
        assertEquals(rows.take(50),DemoReportCodec.decode(DemoReportCodec.encode(rows)))
    }
    @Test fun allCatalogModelsCanBeSimulatedWithoutVoltage() {
        for(target in CoverageRoadmap.targets) {
            val first=DemoReports.make("first",100,target.id,electrical,Random(2))
            val next=DemoReports.make("next",200,target.id,electrical,Random(3))
            assertEquals(target.id,first.targetId)
            assertEquals(first.serial,next.serial)
            assertNotEquals(first.id,next.id)
            assertNull(first.supplyMv)
            assertNull(first.minimumMv)
            assertTrue(first.faults.size in 2..3)
            for(f in first.faults) {
                if(f.reference) assertTrue(ReferenceSelection.forTarget(target.id).any { edition ->
                    val lookup=DisplayReferenceLookup.find(edition,f.code)
                    lookup?.exactPair==true && lookup.component==f.component && lookup.condition==f.description
                }) else assertTrue(f.code.startsWith("DEMO-"))
            }
            assertEquals(listOf(next,first),DemoReportCodec.decode(DemoReportCodec.encode(listOf(next,first))))
        }
    }
    @Test fun sorlHasItsOwnElectronicTesterExamples() {
        val report=DemoReports.make("sorl",1,"sorl-trailer-abs",electrical,Random(8))
        assertTrue(report.faults.all { it.reference && !it.code.startsWith("DEMO-") })
    }
    @Test fun canOnlyDisconnectedScenarioDoesNotInventVoltage() {
        val noCan=DemoElectricalPreview.snapshot(true,DemoElectricalCase.NO_CAN)
        assertNull(noCan.supplyMv)
        assertNull(noCan.minimumMv)
        assertEquals(false,noCan.canTraffic)
        assertFalse(noCan.canRunDemo)
    }
}
