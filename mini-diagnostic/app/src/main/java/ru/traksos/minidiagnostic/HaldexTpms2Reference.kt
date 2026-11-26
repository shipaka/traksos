package ru.traksos.minidiagnostic

// Display examples in Haldex TPMS 2.0 installation guide (2025), pp.55 and 79.
// Indexed source image description; original screenshot could not be retrieved.
// These labels belong to the TPMS receiver, NOT the brake ECU or raw CAN DTCs.
object HaldexTpms2Reference {
    const val SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300062_en.pdf#page=55"
    const val REPORT_SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300062_en.pdf#page=79"
    private val rows=mapOf(
        "81F5FF" to ("Конфигурация TPMS 2.0" to "Ошибка конфигурации системы. Проверить соответствие фактической комплектации сохранённой конфигурации у специалиста; конкретная причина по этому обозначению не установлена."),
        "F002" to ("Давление в шине" to "Пониженное давление. Сверить фактическое давление с нормой для шины и нагрузки."),
        "F000" to ("Давление в шине" to "Критически низкое давление. Безопасно остановиться и проверить шину; не продолжать движение до устранения опасности."),
        "A1002" to ("Связь с колёсным датчиком TPMS" to "Потеря связи. Причину и конкретный датчик установить отдельно."),
        "A1001" to ("Приёмник TPMS 2.0" to "Внутренняя ошибка ЭБУ; сообщение не доказывает необходимость замены.")
    )
    val count get()=rows.size
    fun lookup(code:String):DisplayLookup? {
        val key=code.trim().uppercase(java.util.Locale.ROOT)
        val r=rows[key] ?: return null
        return DisplayLookup(r.first,"Справочный пример (визуальная сверка ожидается): "+r.second,if(key=="81F5FF") REPORT_SOURCE else SOURCE,false)
    }
}
