package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class HaldexEb4DiagReferenceTest {
    @Test fun numericAndDisplayKeysAreOneDocumentedEntry() {
        assertEquals(31,HaldexEb4DiagReference.count)
        assertEquals(22,HaldexEb4DiagReference.numericCount)
        val r=HaldexEb4DiagReference.lookup("0x01")!!
        assertEquals(r,HaldexEb4DiagReference.lookup("S1A continuity"))
        assertTrue(r.condition!!.contains("Обрыв или короткое"))
        assertTrue(HaldexEb4DiagReference.lookup("0x2B")!!.component!!.contains("дополнительного блока 1"))
        assertEquals(HaldexEb4DiagReference.lookup("0x39"),HaldexEb4DiagReference.lookup("SB SLAVE 2 continuity"))
        for(code in listOf("0x3B","0x3C","01","S1A CONT","0x02","SB SLAVE 2 output"))
            assertNull(HaldexEb4DiagReference.lookup(code))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"0x01"))
        assertNull(DtcCatalog().decode(EcuFamily.HALDEX_EB_PLUS,null,RawDtc("000001",DtcStatus.UNKNOWN,"00000100")).descriptionRu)
    }
    @Test fun namedFaultsRetainConfigurationAndSource() {
        val oc=HaldexEb4DiagReference.lookup("AUX 4 OC")!!
        assertTrue(oc.condition!!.contains("Если AUX4 настроен"))
        assertTrue(oc.source!!.endsWith("#page=59"))
        val sc=HaldexEb4DiagReference.lookup("AUX 4 SC")!!
        assertTrue(sc.condition!!.contains("Короткое замыкание"))
        assertTrue(sc.source!!.endsWith("#page=61"))
        val tpms=HaldexEb4DiagReference.lookup("External TPMS")!!
        assertTrue(tpms.condition!!.contains("TPMS 1.0"))
        assertTrue(tpms.source!!.endsWith("#page=41"))
        assertNull(HaldexEb4DiagReference.lookup("AUX 5 OC"))
        val dock=HaldexEb4DiagReference.lookup("Soft Docking")!!
        assertTrue(dock.condition!!.contains("не раскрывает конкретную причину"))
        assertTrue(dock.source!!.endsWith("#page=135"))
        assertNull(HaldexEb4DiagReference.lookup("Soft Docking Sensor Error"))
        assertNull(HaldexAuxReference.softDocking("Soft Docking"))
    }
    @Test fun extendedScreenNamedValvesAreNotNumericCodes() {
        for (channel in listOf("21","22")) for (mode in listOf("hold","dump")) {
            val r=HaldexEb4DiagReference.lookup("EPRV $channel master $mode electric failure")!!
            assertTrue(r.component!!.contains(channel))
            assertTrue(r.condition!!.contains("Точный вид повреждения не указан"))
            assertTrue(r.source!!.endsWith("#page=26"))
        }
        assertNotNull(HaldexEb4DiagReference.lookup("BRK apply master electric failure"))
        assertNull(HaldexEb4DiagReference.lookup("EPRV 23 master hold electric failure"))
        assertNull(HaldexEb4DiagReference.lookup("EPRV 21 master hold"))
    }
    @Test fun auxiliaryContextsRemainSeparate() {
        assertEquals(4,HaldexAuxReference.count)
        assertTrue(HaldexAuxReference.softDocking("EE Data Mismatch")!!.condition!!.contains("расходятся"))
        assertNull(HaldexEb4DiagReference.lookup("Sensor Error"))
        assertNull(HaldexAuxReference.softDocking("Soft Docking"))
        val hub=HaldexAuxReference.canHub("Shutdown FET")!!
        assertEquals(hub,HaldexAuxReference.canHub("ECU SHUTDOWN"))
        assertFalse(hub.exactPair)
        assertTrue(hub.condition!!.contains("25.09.2024"))
        assertNull(HaldexEb4DiagReference.lookup("Shutdown FET"))
        assertTrue(HaldexGen3DiagReference.lookup("ECU shutdown FET")!!.condition!!.contains("CAN Hub"))
    }
}
