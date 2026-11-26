package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class SorlTrailerTesterReferenceTest {
    @Test fun electronicMessagesNeedNumberAndText() {
        assertEquals(27,SorlTrailerTesterReference.count)
        val edition=DisplayReferenceEdition.SORL_ABS_TESTER_36302900020
        for(n in 1..4) {
            val absent=DisplayReferenceLookup.find(edition,"3.$n Нет Д №$n")!!
            val short=DisplayReferenceLookup.find(edition,"3.$n КЗ Д №$n")!!
            assertTrue(absent.component!!.endsWith(n.toString()))
            assertNotEquals(absent.condition,short.condition)
            assertEquals(absent.condition,SorlTrailerTesterReference.lookup("3.$n Нет Д $n")!!.condition)
            assertTrue(SorlTrailerTesterReference.lookup("4.$n Зазор Д №$n")!!.condition!!.contains("зазора"))
            assertTrue(SorlTrailerTesterReference.lookup("4.$n Сигнал Д №$n")!!.condition!!.contains("соединение"))
        }
        assertTrue(SorlTrailerTesterReference.lookup("2.4 КЗ М П")!!.condition!!.contains("замыкание"))
        assertTrue(SorlTrailerTesterReference.lookup("8.2 Низк. напр.")!!.source!!.contains("#page=14"))
        for(code in listOf("2.1","3.1","8.2","3.1 Нет Д №2","3.1 Нет Д 1 1","7.1 Ош. лампы.","АБС исправна","11"))
            assertNull(SorlTrailerTesterReference.lookup(code))
        assertNull(DisplayReferenceLookup.find(DisplayReferenceEdition.VIE_101,"3.1 Нет Д №1"))
        assertTrue(ReferenceSelection.forTarget("sorl-research").isEmpty())
    }
}
