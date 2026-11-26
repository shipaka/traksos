package ru.traksos.minidiagnostic

// Expert mode of VCS first generation. Two displayed groups only, excluding frequency.
// Not Vario C, VCS II or a wire protocol.
object WabcoVcsReference {
    const val SOURCE="https://www.etsp.ru/documents/blink_codes_vcs_.pdf"
    private val rows=buildMap<String,Pair<String,String>> {
        listOf("H2 (c)","H1 (d)","Z2/L2 (e)","Z1/L1 (f)").forEachIndexed { i,sensor ->
            for((type,condition) in listOf(5 to "Обрыв или КЗ",7 to "Зазор датчика",
                10 to "Скачок скорости",11 to "Давление в шине")) {
                put("${i+3}/$type","Колёсный датчик $sensor" to condition)
            }
        }
        for((component,name) in listOf(7 to "Модулятор L (A)",9 to "Модулятор H2 (C)",
            10 to "Модулятор H1 (B)",13 to "Управление ретардером")) {
            for((type,condition) in listOf(3 to "Внешнее питание",5 to "Обрыв",
                6 to "КЗ на массу",12 to "Внутренняя неисправность ЭБУ")) {
                put("$component/$type",name to condition)
            }
        }
        put("14/2","Конфигурация ABS" to "Не совпадает с сохранённой")
        put("14/3","Питание" to "Перенапряжение")
        put("14/4","Питание" to "Пониженное напряжение")
        put("14/5","Контрольная лампа" to "Нарушение цепи массы")
        put("14/12","Цепи отключения" to "Неисправность")
        put("15/9","ЭБУ" to "Электромагнитная помеха")
        put("15/12","ЭБУ" to "Внутренний сбой")
    }
    fun lookup(code:String)=rows[code]
    val count get()=rows.size
}
