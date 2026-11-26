package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test

class VieDisplayReferenceTest {
    @Test fun documentedPairsOnly() {
        val v=EcuFamily.VIE_TEBS
        assertEquals(41,VieDisplayReference.count)
        assertEquals("Датчик скорости колеса E",VieDisplayReference.lookup(v,"3/5")?.component)
        assertEquals("Датчик скорости колеса C",VieDisplayReference.lookup(v,"5/5")?.component)
        assertEquals("Разрыв цепи",VieDisplayReference.lookup(v,"5/5")?.condition)
        assertEquals("A1.41",VieDisplayReference.lookup(v,"254/15")?.section)
        assertNull(VieDisplayReference.lookup(v,"3/2"))
        assertNull(VieDisplayReference.lookup(v,"003/05"))
        assertNull(VieDisplayReference.lookup(EcuFamily.WABCO_TEBS_E,"3/5"))
        assertNull(DtcCatalog().decode(v,null,RawDtc("030005",DtcStatus.UNKNOWN,"03000500")).descriptionRu)
        assertEquals((1..41).map { "A1.$it" }.toSet(),VieDisplayReference.entries(v).map { it.section }.toSet())
    }
}
