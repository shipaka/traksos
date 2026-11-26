package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class HaldexEb4DiagReferenceTest {
    @Test fun numericAndDisplayKeysAreOneDocumentedEntry() {
        assertEquals(22,HaldexEb4DiagReference.count)
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
