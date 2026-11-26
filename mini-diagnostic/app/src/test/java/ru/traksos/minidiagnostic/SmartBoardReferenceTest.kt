package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class SmartBoardReferenceTest {
    @Test fun generationSpecificComponentCodesAreNotInterchangeable() {
        val d=EcuFamily.WABCO_TEBS_D
        val e=EcuFamily.WABCO_TEBS_E
        for (code in listOf("007","010","059","062","081","083")) {
            assertNotEquals(SmartBoardReference.lookup(d,code)?.titleRu,SmartBoardReference.lookup(e,code)?.titleRu)
        }
        assertNotNull(SmartBoardReference.lookup(d,"221"))
        assertNull(SmartBoardReference.lookup(e,"221"))
    }
    @Test fun twoDisplayFieldsAreIndependent() {
        val m=SmartBoardReference.decode(EcuFamily.WABCO_TEBS_E,"003","05")
        assertEquals("Колёсный датчик C",m.component?.titleRu)
        assertEquals("Обрыв питающего проводника",m.faultType?.titleRu)
        assertNull(SmartBoardReference.decode(EcuFamily.WABCO_TEBS_E,"999","05").component)
        assertNull(SmartBoardReference.decode(EcuFamily.WABCO_TEBS_E,"003","99").faultType)
        assertNull(SmartBoardReference.decode(EcuFamily.VIE_TEBS,"003","05").faultType)
    }
    @Test fun noDecimalOrHexGuessing() {
        val family=EcuFamily.WABCO_TEBS_E
        assertNull(SmartBoardReference.lookup(family,"3"))
        assertNull(SmartBoardReference.lookup(family,"000003"))
        assertNull(SmartBoardReference.decode(family,"003","5").faultType)
        assertNull(DtcCatalog().decode(family,null,RawDtc("000003",DtcStatus.UNKNOWN,"00000305")).descriptionRu)
    }
}
