package ru.traksos.minidiagnostic

// Display examples in Haldex TPMS 2.0 installation guide (2025), p.55.
// Indexed source image description; original screenshot could not be retrieved.
// These labels belong to the TPMS receiver, NOT the brake ECU or raw CAN DTCs.
object HaldexTpms2Reference {
    const val SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300062_en.pdf#page=55"
    private val rows=mapOf(
        "F002" to ("Давление в шине" to "Пониженное давление. Сверить фактическое давление с нормой для шины и нагрузки."),
        "F000" to ("Давление в шине" to "Критически низкое давление. Безопасно остановиться и проверить шину; не продолжать движение до устранения опасности."),
        "A1002" to ("Связь с колёсным датчиком TPMS" to "Потеря связи. Причину и конкретный датчик установить отдельно."),
        "A1001" to ("Приёмник TPMS 2.0" to "Внутренняя ошибка ЭБУ; сообщение не доказывает необходимость замены.")
    )
    val count get()=rows.size
    fun lookup(code:String):DisplayLookup? {
        val r=rows[code.trim().uppercase(java.util.Locale.ROOT)] ?: return null
        return DisplayLookup(r.first,"Справочный пример (визуальная сверка ожидается): "+r.second,SOURCE,false)
    }
}
