package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class SmartBoardSystemReferenceTest {
    @Test fun editionsDoNotMix() {
        assertEquals(125,SmartBoardSystemReference.systemComponentCount)
        assertEquals(116,SmartBoardSystemReference.driverExtraCount)
        val old=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E_SYSTEM,"082/15")!!
        val driver=DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"082/15")!!
        assertNotEquals(old.component,driver.component)
        assertEquals("Остаточное давление",old.condition)
        assertTrue(DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_D_SYSTEM,"003/05")!!.condition!!.contains("Противоречие"))
        assertNull(SmartBoardSystemReference.find(true,"999","06"))
        assertEquals("Обрыв питающего проводника",DisplayReferenceLookup.find(DisplayReferenceEdition.WABCO_E,"003/05")!!.condition)
        assertNotNull(SmartBoardReference.lookup(EcuFamily.WABCO_TEBS_E,"217"))
        assertNull(SmartBoardReference.lookup(EcuFamily.WABCO_TEBS_E,"156"))
    }
}
