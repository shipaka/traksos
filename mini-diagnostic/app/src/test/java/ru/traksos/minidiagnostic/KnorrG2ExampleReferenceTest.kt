package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class KnorrG2ExampleReferenceTest {
    @Test fun exactDisplayCodeNotWireBytesOrOtherGeneration() {
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_G2_EXAMPLE,"001200")!!
        assertTrue(r.exactPair)
        assertEquals("Датчик скорости колеса S-C",r.component)
        assertTrue(r.condition!!.contains("на массу"))
        assertTrue(r.source!!.contains("Demo Mode"))
        assertEquals(2,KnorrG2ExampleReference.count)
        val tim=KnorrG2ExampleReference.lookup("000D00")!!
        assertTrue(tim.exactPair)
        assertTrue(tim.condition!!.contains("Обрыв цепи или замыкание на плюс"))
        assertTrue(tim.source!!.contains("Y054277"))
        assertNull(KnorrG2Td2077Reference.lookup("000D00"))
        for(code in listOf("1200","001201","0x001200","0012/00","001300"))
            assertNull(KnorrG2ExampleReference.lookup(code))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_TEBS4,"001200"))
        assertNull(DtcCatalog().decode(EcuFamily.KNORR_TEBS_G2,null,RawDtc("001200",DtcStatus.UNKNOWN,"00120000")).descriptionRu)
    }
}
