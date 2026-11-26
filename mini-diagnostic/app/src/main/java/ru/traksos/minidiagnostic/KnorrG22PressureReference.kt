package ru.traksos.minidiagnostic

// OEM bulletin verifies the three-code group; precise port descriptions are
// from a secondary text transcription. Never interpret as raw UDS bytes.
object KnorrG22PressureReference {
    const val BULLETIN="https://8afjlxvy4piyx8zzzs6kqim.blob.core.windows.net/documents/IFJABMioI0EBhB_Y338736_EN_000.pdf"
    private const val TABLE="https://www.scribd.com/document/920465068/PDF-2024061305"
    private val rows=mapOf(
        "00ED00" to "Подающее давление P1",
        "00F300" to "Давление на выходе P21 к тормозным камерам",
        "00F500" to "Давление на выходе P22 к тормозным камерам"
    )
    fun lookup(code:String):DisplayLookup? {
        val component=rows[code] ?: return null
        return DisplayLookup(component,
            "Несоответствие показаний давления (по копии TD-2077). Для ПО G2.2 до 730.58 включительно известен заводской бюллетень об обновлении. Не считать код доказательством поломки датчика; нужна проверка давления, магистралей и версии ПО специалистом.",
            BULLETIN+" · Y338736, 2019, стр.1 (группа кодов)\n"+TABLE+" · TD-2077, стр.28 (привязка портов, текстовая копия)",
            false)
    }
    val count get()=rows.size
}
