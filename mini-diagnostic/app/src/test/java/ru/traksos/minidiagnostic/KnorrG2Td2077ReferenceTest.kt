package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class KnorrG2Td2077ReferenceTest {
    @Test fun provisionalRowsNeverClaimExactProfileOrDuplicateEarlierCodes() {
        assertEquals(99,KnorrG2Td2077Reference.count)
        assertEquals(14,KnorrG2Td2077Reference.originalTextMatchedCount)
        assertTrue(KnorrG2Td2077Reference.lookup("000700")!!.source!!.contains("индексированным"))
        assertEquals("Датчик колеса D",KnorrG2Td2077Reference.lookup("000C00")!!.component)
        val r=DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_G2_TD2077,"002400")!!
        assertEquals("Датчик колеса C",r.component)
        assertTrue(r.condition!!.contains("Большой зазор"))
        assertTrue(r.condition!!.contains("предварительно"))
        assertFalse(r.exactPair)
        assertTrue(r.source!!.contains("TD-2077"))
        assertTrue(KnorrG2Td2077Reference.lookup("01C600")!!.condition!!.contains("электронный запрос"))
        assertFalse(KnorrG2Td2077Reference.lookup("01A600")!!.exactPair)
        assertTrue(KnorrG2Td2077Reference.lookup("019A00")!!.condition!!.contains("EOL"))
        assertTrue(KnorrG2Td2077Reference.lookup("000200")!!.condition!!.contains("контрольной суммы"))
        assertTrue(KnorrG2Td2077Reference.lookup("000600")!!.condition!!.contains("записи EEPROM"))
        assertTrue(KnorrG2Td2077Reference.lookup("003700")!!.condition!!.contains("расходится"))
        assertTrue(KnorrG2Td2077Reference.lookup("016D00")!!.condition!!.contains("противоречивы"))
        assertTrue(KnorrG2Td2077Reference.lookup("013300")!!.condition!!.contains("сопутствующий код"))
        assertFalse(KnorrG2Td2077Reference.lookup("012F00")!!.exactPair)
        assertNull(KnorrG2Td2077Reference.lookup("003C00"))
        for(code in listOf("000D00","001200","00ED00","00F300","00F500","003A00","2400","0x002400"))
            assertNull(KnorrG2Td2077Reference.lookup(code))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.KNORR_G22_PRESSURE,"002400"))
        assertNull(DtcCatalog().decode(EcuFamily.KNORR_TEBS_G2,null,RawDtc("002400",DtcStatus.UNKNOWN,"00240000")).descriptionRu)
    }
}
