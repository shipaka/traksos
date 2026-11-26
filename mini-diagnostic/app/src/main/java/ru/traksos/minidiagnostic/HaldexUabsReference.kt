package ru.traksos.minidiagnostic

// Independent U-ABS electronic Info Centre 2 reference. Not blink codes or raw CAN DTCs.
object HaldexUabsReference {
    const val SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_ru.pdf#page=47"
    const val SOURCE_EN="https://www.haldex.com/globalassets/europe/61.-documents/abs-system/006300022_gb.pdf#page=51"
    const val INFO_CENTRE_SCOPE="https://www.haldex.com/sv/europe/trailer-application-guide/ebs/Features/info-centre/"
    const val MIN_INFO_CENTRE_SOFTWARE="A650"
    private data class Entry(val component:String,val condition:String,val grouped:Boolean=false)
    private val rows=buildMap<String,Entry> {
        for (n in listOf("1","2")) {
            val c="Колёсный датчик "+n+"A или "+n+"B"
            put("Wheel sensor "+n+"A or "+n+"B continuity",Entry(c,"Обрыв или КЗ датчика либо жгута; колесо не определено",true))
            put("Wheel sensor "+n+"A or "+n+"B signal integrity",Entry(c,"Некорректный сигнал; колесо не определено",true))
            put("Wheel sensor "+n+"A or "+n+"B output level",Entry(c,"Сбой системы измерения скорости; колесо не определено",true))
        }
        for ((mode,part) in listOf("hold" to "удержания","dump" to "сброса")) {
            val c="Соленоид "+part+" модулятора 21 или 22"
            for ((suffix,condition) in listOf("short circuit" to "КЗ цепи","open circuit" to "Обрыв цепи","short to B+" to "КЗ при возбуждении цепи; уточнить электрическую причину","unspecified fault" to "Сбой цепи управления"))
                put("EPRV 21 or 22 "+mode+" solenoid "+suffix,Entry(c,condition+"; конкретный канал не определён",true))
        }
        put("EPRV 21 or 22 delivery sensor short circuit",Entry("Датчик давления модулятора 21 или 22","КЗ цепи; канал не определён",true))
        put("EPRV 21 or 22 delivery open circuit",Entry("Датчик давления модулятора 21 или 22","Обрыв цепи; канал не определён",true))
        put("EPRV 21 or 22 slow wheel recovery",Entry("Модулятор 21 или 22","Замедленное восстановление скорости одного колеса; канал не определён",true))
        put("Slave valve modulator",Entry("Ведомый модулятор","Возможны обрыв или КЗ соленоида удержания/сброса"))
        put("Slave valve cable",Entry("Жгут ведомого модулятора","Обрыв или КЗ соединительной цепи"))
        put("Slave valve slow recovery",Entry("Ведомый модулятор","Замедленное восстановление скорости одного колеса"))
        put("Power ISO 7638 fail",Entry("Питание ISO 7638","Потеря питания на контакте 1 или 2; требуется проверка"))
        put("Power low voltage",Entry("Питание ЭБУ","Напряжение ниже 16 В по данной редакции U-ABS; не применять порог Gen3"))
        put("Power high voltage",Entry("Питание ЭБУ","Напряжение выше 32 В по данной редакции U-ABS"))
        put("Power unspecified fault",Entry("ЭБУ","Внутренний сбой; точная причина не определена"))
        put("ECU EEprom error",Entry("ЭБУ","Внутренняя ошибка"))
        put("ECU configuration error",Entry("ЭБУ","Отсутствует программирование; проверка специалистом"))
        put("ECU EEprom unspecified error",Entry("ЭБУ","Внутренняя ошибка без уточнения"))
        put("ECU shutdown FET",Entry("ЭБУ","Внутренняя неисправность; не основание для замены блока"))
        put("AUX 1 / AUX 2 / AUX 3",Entry("Дополнительная цепь AUX 1, 2 или 3","Обрыв или КЗ проводки; назначение зависит от конфигурации",true))
        put("External TPMS",Entry("Внешняя TPMS","Аппаратный сбой системы; конкретный элемент не определён"))
    }.mapKeys { it.key.lowercase() }
    val count get()=rows.size
    fun lookup(code:String):DisplayLookup? {
        val key=code.trim().lowercase()
        val normalized=when(key) {
            "power iso7638 fail" -> "power iso 7638 fail"
            "aux 1","aux 2","aux 3" -> "aux 1 / aux 2 / aux 3"
            else -> key
        }
        val r=rows[normalized] ?: return null
        return DisplayLookup(r.component,r.condition,SOURCE+"\n"+SOURCE_EN,!r.grouped)
    }
}
