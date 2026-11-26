package ru.traksos.minidiagnostic
import org.junit.Assert.*
import org.junit.Test
class ModuleSearchTest {
    @Test fun shorthandAndTransliteratedLabels() {
        for(q in listOf("TEBS E","TEBSE","ТЭПСЕ","TEPSYE","вабка тэпсе","WABCO TEBS E")) {
            assertEquals(q,"zf-tebs-e",ModuleSearch.find(q).firstOrNull()?.id)
        }
        assertTrue(ModuleSearch.find("сорл").any { it.id=="sorl-research" })
        assertTrue(ModuleSearch.find("VCS 2").any { it.id=="zf-vcs-ii" })
        assertTrue(ModuleSearch.find("Экран ЭБП").any { it.id=="ekran-ebp" })
    }
    @Test fun broadTermsStayAmbiguous() {
        val tebs=ModuleSearch.find("TEBS")
        assertTrue(tebs.map { it.maker }.toSet().size>1)
        assertTrue(tebs.any { it.id=="zf-tebs-d" })
        assertTrue(tebs.any { it.id=="zf-tebs-e" })
        assertTrue(tebs.any { it.id=="vie-tebs" })
        assertEquals(36,ModuleSearch.find("").size)
        assertTrue(ModuleSearch.find("?!").isEmpty())
        assertTrue(ModuleSearch.find("unlisted-module-1234567").isEmpty())
    }
}
